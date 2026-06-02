'use strict'

import * as vscode from 'vscode'
import { tasks, tasks_v1 } from '@googleapis/tasks'
import { OAuth2Client } from 'googleapis-common'

import { GTaskList } from './GTaskList.treeItem'
import { GTask } from './GTask.treeItem'
import { CompletedTasksSection } from './CompletedTasks.treeItem'

type GTaskTreeItem = GTask | GTaskList | CompletedTasksSection

class GTaskTreeProvider implements vscode.TreeDataProvider<GTaskTreeItem> {
  service?: tasks_v1.Tasks

  private _onDidChangeTreeData: vscode.EventEmitter<undefined> = new vscode.EventEmitter<undefined>()
  readonly onDidChangeTreeData: vscode.Event<undefined> = this._onDidChangeTreeData.event
  private _showCompleted = false

  setOAuthClient(oAuth2Client: OAuth2Client): GTaskTreeProvider {
    this.service = tasks({ version: 'v1', auth: oAuth2Client })
    return this
  }

  // Overrides
  getTreeItem(element: GTaskTreeItem): vscode.TreeItem | Promise<vscode.TreeItem> {
    return element
  }

  // Overrides
  async getChildren(element?: GTaskTreeItem): Promise<GTaskTreeItem[]> {
    if (!this.service) {
      vscode.window.showErrorMessage('oAuth client is not initialized')
      return []
    }
    if (!element) {
      const { data } = await this.service.tasklists.list()
      const list = data.items || []
      const taskLists = await Promise.all(
        list.map((taskList, index) =>
          GTaskListBuilder.build(
            taskList,
            // @ts-ignore
            this.service,
            this._showCompleted,
            index === 0  // Auto-expand first tasklist
          )
        )
      )

      const items: GTaskTreeItem[] = [...taskLists]

      // Add completed tasks section at the end
      const completedSection = await this.buildCompletedTasksSection()
      if (completedSection && completedSection.completedTasks.length > 0) {
        items.push(completedSection)
      }

      return items
    } else if (this._isCompletedTasksSection(element)) {
      // Return completed tasks when the section is expanded
      return element.completedTasks
    } else if (this._isTask(element)) {
      element.children.sort(sortTasks)
      return element.children.map(childTask => new GTask(element.taskListId, childTask))
    } else if (this._isTaskList(element)) return element.childTaskList || []

    vscode.window.showErrorMessage('Unknown element in getChildren')
    console.log('Unknown element in getChildren', element)
    return []
  }

  private _isTaskList(gTaskTreeItem: GTaskTreeItem): gTaskTreeItem is GTaskList {
    return (gTaskTreeItem as GTaskList).taskList !== undefined
  }

  private _isTask(gTaskTreeItem: GTaskTreeItem): gTaskTreeItem is GTask {
    return (gTaskTreeItem as GTask).task !== undefined
  }

  private _isCompletedTasksSection(gTaskTreeItem: GTaskTreeItem): gTaskTreeItem is CompletedTasksSection {
    return (gTaskTreeItem as CompletedTasksSection).completedTasks !== undefined
  }

  private async buildCompletedTasksSection(): Promise<CompletedTasksSection | null> {
    if (!this.service) return null

    try {
      const { data } = await this.service.tasklists.list()
      const lists = data.items || []
      const allCompletedTasks: GTask[] = []

      // Fetch completed tasks from all task lists
      for (const taskList of lists) {
        if (taskList.id) {
          const { data: tasksData } = await this.service.tasks.list({
            tasklist: taskList.id,
            showCompleted: true,
            showHidden: true,
          })

          const tasks = tasksData.items || []
          const completedTasks = tasks.filter(task => task.status === 'completed')

          // Add completed tasks with their taskListId
          completedTasks.forEach(task => {
            allCompletedTasks.push(new GTask(taskList.id || '', task))
          })
        }
      }

      // Sort by completion date (most recent first)
      allCompletedTasks.sort((a, b) => {
        const aDate = a.task.completed || ''
        const bDate = b.task.completed || ''
        return bDate.localeCompare(aDate)
      })

      return new CompletedTasksSection(allCompletedTasks)
    } catch (error) {
      console.error('[GTaskTreeProvider] Error building completed tasks section:', error)
      return null
    }
  }

  refresh(options?: { showCompleted?: boolean }): void {
    if (options && options.showCompleted !== undefined)
      this._showCompleted = Boolean(options.showCompleted)
    this._onDidChangeTreeData.fire(undefined)
  }

  async addTaskList(tasklist: tasks_v1.Params$Resource$Tasklists$Insert) {
    await this.service?.tasklists.insert(tasklist)
    this.refresh()
  }

  async deleteTaskList(taskList: tasks_v1.Params$Resource$Tasklists$Delete) {
    await this.service?.tasklists.delete(taskList)
    this.refresh()
  }

  async updateTaskList(taskList: tasks_v1.Params$Resource$Tasklists$Patch) {
    await this.service?.tasklists.patch(taskList)
    this.refresh()
  }

  async addTask(newTask: tasks_v1.Params$Resource$Tasks$Insert) {
    await this.service?.tasks.insert(newTask)
    this.refresh()
  }

  async patchTask(task: tasks_v1.Params$Resource$Tasks$Patch) {
    await this.service?.tasks.patch(task)
    this.refresh()
  }

  deleteTask(task: tasks_v1.Params$Resource$Tasks$Delete) {
    this.service?.tasks.delete(task)
    this.refresh()
  }
}

class GTaskListBuilder {
  private constructor() { }

  static async build(
    taskList: tasks_v1.Schema$TaskList,
    service: tasks_v1.Tasks,
    showCompleted: boolean,
    isExpanded: boolean = false
  ): Promise<GTaskList> {
    const { data } = await service.tasks.list({
      tasklist: taskList.id || '',
      showHidden: showCompleted,
      showCompleted,
    })
    let list = data.items || []
    let children: { [key: string]: tasks_v1.Schema$Task[] } = {}
    list = list.filter(task => {
      if (!task.parent) return true

      if (children[task.parent || 'error']) children[task.parent || 'error'].push(task)
      else children[task.parent || 'error'] = [task]
      return false
    })
    list.sort(sortTasks)
    const gTaskList = new GTaskList(
      taskList,
      list.map(task => new GTask(taskList.id || '', task, children[task.id || 'error']))
    )

    // Set expanded state for first tasklist
    if (isExpanded) {
      gTaskList.collapsibleState = vscode.TreeItemCollapsibleState.Expanded
    }

    return gTaskList
  }
}

function sortTasks(a: tasks_v1.Schema$Task, b: tasks_v1.Schema$Task): number {
  if (!(a.position && b.position)) return 0
  return a.position > b.position ? 1 : a.position < b.position ? -1 : 0
}

export default new GTaskTreeProvider()

import * as vscode from 'vscode'
import * as path from 'path'
import { tasks_v1 } from '@googleapis/tasks'

import { RootPath } from '../../../RootPath'
import { formatDueDate } from '../../utils/DateTimeUtils'

type NodeType = 'task' | 'taskList' | 'completedTask' | 'completedTaskList'

export class GTask extends vscode.TreeItem {
  contextValue = 'GTask'

  constructor(
    public taskListId: string,
    public task: tasks_v1.Schema$Task,
    public children: tasks_v1.Schema$Task[] = []
  ) {
    super(
      task.title || 'No Title Provided',
      children.length
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None
    )
    if (task.parent) this.contextValue += 'SubItem'

    // Add context for scheduling menu visibility
    if (task.due) this.contextValue += '+has-schedule'

    // Set command for double-click to edit task
    this.command = {
      title: 'Edit Task',
      command: 'googleTasks.editTask',
      arguments: [this],
    }
  }

  // Overrides
  // @ts-ignore
  get tooltip(): string {
    return this.task.notes || this.task.title || 'No Title Provided'
  }

  // Overrides
  // @ts-ignore
  get description(): string {
    const hasChildren = Boolean(this.children.length)
    const hasNotes = Boolean(this.task.notes)
    const hasDueDate = Boolean(this.task.due)

    let description = ''

    // Add child count
    if (hasChildren) {
      description += this.children.length.toString()
    }

    // Add separator if we have multiple info items
    if (hasChildren && (hasNotes || hasDueDate)) {
      description += ' · '
    }

    // Add due date with formatting
    if (hasDueDate && this.task.due) {
      const recurring = (this.task as any).recurringPattern || undefined
      description += formatDueDate(this.task.due, recurring)
    }

    // Add separator between due date and notes
    if (hasDueDate && hasNotes) {
      description += ' · '
    }

    // Add notes
    if (hasNotes) {
      description += this.task.notes
    }

    return description
  }
  // Overrides
  // @ts-ignore
  get iconPath() {
    const icon = `icon-task-${this.task.completed ? 'completed.svg' : 'incomplete.svg'}`
    return {
      light: path.join(RootPath.path, 'resources', `light-${icon}`),
      dark: path.join(RootPath.path, 'resources', `dark-${icon}`),
    }
  }
}

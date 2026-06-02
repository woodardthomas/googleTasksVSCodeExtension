import * as vscode from 'vscode'
import { GTask } from './GTask.treeItem'

export class CompletedTasksSection extends vscode.TreeItem {
    contextValue = 'CompletedTasksSection'

    constructor(public completedTasks: GTask[]) {
        super('Completed Tasks', vscode.TreeItemCollapsibleState.Collapsed)
        this.iconPath = new vscode.ThemeIcon('check-all')
        this.tooltip = `${this.completedTasks.length} completed task${this.completedTasks.length !== 1 ? 's' : ''}`
        this.description = this.completedTasks.length.toString()
    }
}

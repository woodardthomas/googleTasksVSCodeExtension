import * as vscode from 'vscode'

import loadGoogleTasks from './app/TreeDataLoader'
import { registerRootPath } from './RootPath'
import { extensionQualifiedId } from './Constants'
import { registerCommands } from './app/commands/commands'
import { ScheduleWebViewProvider } from './app/providers/ScheduleWebViewProvider'
import { CalendarWebViewProvider } from './app/providers/CalendarWebViewProvider'
import getOAuthClient from './app/OAuthClient'
import { getStoredToken } from './app/Token'
import gTaskTreeProvider from './app/TreeDataProviders/GTask/GTask.TreeDataProvider'

let scheduleWebViewProvider: ScheduleWebViewProvider
let calendarWebViewProvider: CalendarWebViewProvider

/**
 * Initialize or reinitialize calendar OAuth credentials
 */
export function initializeCalendarOAuth() {
  try {
    const oAuthClient = getOAuthClient()
    const token = getStoredToken()
    oAuthClient.setCredentials(token)
    calendarWebViewProvider.setOAuthClient(oAuthClient)
    calendarWebViewProvider.setTaskProvider(gTaskTreeProvider)
    console.log('[Calendar] OAuth initialized successfully')
  } catch (err) {
    console.log('[Calendar] OAuth not ready:', err)
  }
}

export function activate(context: vscode.ExtensionContext) {
  const startTime = process.hrtime()

  registerRootPath(context)

  // Initialize WebView providers
  scheduleWebViewProvider = new ScheduleWebViewProvider(context)
  calendarWebViewProvider = new CalendarWebViewProvider(context)

  // Initialize Calendar provider with OAuth
  initializeCalendarOAuth()

  // Register feature commands (pass both providers)
  registerCommands(scheduleWebViewProvider, calendarWebViewProvider, context)

  // Register calendar command
  const calendarCommand = vscode.commands.registerCommand('googleTasks.openCalendar', () => {
    calendarWebViewProvider.showCalendar()
  })
  context.subscriptions.push(calendarCommand)

  loadGoogleTasks()

  logExtensionActivated(context, startTime)
}

function logExtensionActivated(context: vscode.ExtensionContext, startTime: [number, number]) {
  // Prefer version from this extension's context; fall back to the marketplace extension if available
  let googleTasksVersion: string = 'dev'
  try {
    googleTasksVersion = (context as any)?.extension?.packageJSON?.version || googleTasksVersion
  } catch { }
  if (!googleTasksVersion) {
    const googleTasks = vscode.extensions.getExtension(extensionQualifiedId)
    if (googleTasks && (googleTasks as any).packageJSON?.version) {
      googleTasksVersion = (googleTasks as any).packageJSON.version
    }
  }
  const [secs, nanoseconds] = process.hrtime(startTime)
  const duration = secs * 1000 + Math.floor(nanoseconds / 1000000)
  console.log(`GoogleTasks (v${googleTasksVersion}) activated in ${duration}ms`)
}

export function deactivate() {
  // Cleanup if needed
}

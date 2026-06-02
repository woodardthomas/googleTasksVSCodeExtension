'use strict'

import * as vscode from 'vscode'
import { OAuth2Client } from 'googleapis-common'

import gTaskTreeProvider from './TreeDataProviders/GTask/GTask.TreeDataProvider'
import getOAuthClient from './OAuthClient'
import { getStoredToken } from './Token'

export default function loadTreeData() {
  try {
    const oAuth2Client = getOAuthClient()
    const token = getStoredToken()
    oAuth2Client.setCredentials(token)
    attachTreeProvider(oAuth2Client)
    vscode.commands.executeCommand('setContext', 'GoogleUserTokenExists', true)
  } catch (err) {
    if ((err as any).message === 'Token not found') {
      // User is likely not authenticated
    } else if ((err as any).message === 'Credentials not found') {
      vscode.window.showErrorMessage(
        'Google Tasks: Credentials not found. Please register your client application credentials.'
      )
    } else {
      vscode.window.showErrorMessage(
        (err as any).message || 'Unknown Error. Please create an issue in Github.'
      )
    }
  }
}

async function attachTreeProvider(oAuth2Client: OAuth2Client) {
  gTaskTreeProvider.setOAuthClient(oAuth2Client)
  vscode.window.registerTreeDataProvider('googleTasks', gTaskTreeProvider)
  vscode.commands.executeCommand('setContext', 'HideCompleted', true)
}

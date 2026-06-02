'use strict'

import * as vscode from 'vscode'
import { OAuth2Client } from 'googleapis-common'

import loadTreeData from './TreeDataLoader'
import getOAuthClient from './OAuthClient'
import { storeToken } from './Token'
import getOAuthCode from './server'

export default async function initiateUserAuthorization() {
  try {
    const oAuth2Client = getOAuthClient()
    const SCOPES = [
      'https://www.googleapis.com/auth/tasks',
      'https://www.googleapis.com/auth/calendar'
    ]
    const authUrl = oAuth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
      prompt: 'consent'  // Force showing consent screen with all permissions
    })
    await getOAuthCodeFromUser(authUrl, oAuth2Client)
    loadTreeData()

    // Reinitialize Calendar OAuth after authorization
    try {
      const { initializeCalendarOAuth } = await import('../extension')
      initializeCalendarOAuth()
      vscode.window.showInformationMessage('Calendar access granted! You can now open the calendar view.')
    } catch (err) {
      console.log('Could not reinitialize calendar OAuth:', err)
    }
  } catch (error) {
    vscode.window.showErrorMessage('Error in user authorization')
    console.error(error)
  }
}

async function getOAuthCodeFromUser(authUrl: string, oAuth2Client: OAuth2Client) {
  vscode.env.openExternal(vscode.Uri.parse(authUrl))
  try {
    const code = await getOAuthCode()
    const { tokens } = await oAuth2Client.getToken(code)
    storeToken(tokens)
  } catch (error) {
    vscode.window.showErrorMessage('Error in authorization: ' + ((error as any).message || 'Unknown error'))
    throw new Error()
  }
}

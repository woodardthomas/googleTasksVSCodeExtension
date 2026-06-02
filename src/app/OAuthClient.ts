import { auth } from '@googleapis/tasks'
import { OAuth2Client } from 'googleapis-common'
import { RootPath } from '../RootPath'

export default function getOAuthClient(): OAuth2Client {
  const credentials = getCredentials()
  try {
    const { client_secret, client_id } = credentials.installed
    const oAuth2Client = new auth.OAuth2(client_id, client_secret, 'http://localhost:11223')
    return oAuth2Client
  } catch (err) {
    console.error(err)
    throw new Error('Error creating OAuthClient')
  }
}

// Credentials injected at build time or read from the environment
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';

const credentials = {
  installed: {
    client_id: GOOGLE_CLIENT_ID,
    project_id: "vscode-tasks-extension",
    auth_uri: "https://accounts.google.com/o/oauth2/auth",
    token_uri: "https://oauth2.googleapis.com/token",
    auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
    client_secret: GOOGLE_CLIENT_SECRET,
    redirect_uris: ["http://localhost:11223"]
  }
}

function getCredentials() {
  return credentials
}


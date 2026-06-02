/**
 * Google Calendar API provider
 * Handles fetching, creating, updating, and deleting calendar events
 */

import { calendar, calendar_v3 } from '@googleapis/calendar'
import { OAuth2Client } from 'googleapis-common'

export interface CalendarEvent {
    id?: string | null
    summary?: string | null
    description?: string
    start: {
        dateTime?: string // RFC 3339 with time
        date?: string // YYYY-MM-DD for all-day events
    }
    end: {
        dateTime?: string
        date?: string
    }
    recurrence?: string[]
    reminders?: {
        useDefault?: boolean
        overrides?: Array<{
            method: 'email' | 'popup'
            minutes: number
        }>
    }
    extendedProperties?: {
        private?: {
            [key: string]: string
        }
    }
}

export class CalendarProvider {
    private calendarService: calendar_v3.Calendar
    private oAuthClient: OAuth2Client

    constructor(oAuthClient: OAuth2Client) {
        this.oAuthClient = oAuthClient
        this.calendarService = calendar({
            version: 'v3',
            auth: oAuthClient,
        })
    }

    /**
     * Get events from primary calendar within a date range
     */
    async getEventsInRange(startDate: Date, endDate: Date): Promise<CalendarEvent[]> {
        try {
            const response = await this.calendarService.events.list({
                calendarId: 'primary',
                timeMin: startDate.toISOString(),
                timeMax: endDate.toISOString(),
                singleEvents: true,
                orderBy: 'startTime',
                showDeleted: false,
            })

            const events = response.data.items || []
            console.log(`[Calendar] Fetched ${events.length} events from ${startDate.toDateString()} to ${endDate.toDateString()}`)
            return events as CalendarEvent[]
        } catch (error) {
            console.error('[Calendar] Error fetching events:', error)
            throw error
        }
    }

    /**
     * Get events for a specific month
     */
    async getEventsForMonth(year: number, month: number): Promise<CalendarEvent[]> {
        const startDate = new Date(year, month, 1)
        const endDate = new Date(year, month + 1, 0)
        endDate.setHours(23, 59, 59, 999)
        return this.getEventsInRange(startDate, endDate)
    }

    /**
     * Create a new calendar event
     */
    async createEvent(eventData: {
        summary: string
        description?: string
        startDate: string // YYYY-MM-DD or ISO string with time
        endDate: string
        isAllDay?: boolean
        recurrence?: string[]
        reminders?: Array<{ method: 'email' | 'popup'; minutes: number }>
        isTask?: boolean // Tag as task-related
    }): Promise<CalendarEvent> {
        try {
            const event: calendar_v3.Schema$Event = {
                summary: eventData.summary,
                description: eventData.description || '',
            }

            // Set start and end times
            if (eventData.isAllDay) {
                event.start = { date: eventData.startDate }
                event.end = { date: eventData.endDate }
            } else {
                event.start = { dateTime: eventData.startDate }
                event.end = { dateTime: eventData.endDate }
            }

            // Add recurrence if provided
            if (eventData.recurrence && eventData.recurrence.length > 0) {
                event.recurrence = eventData.recurrence
            }

            // Add reminders
            if (eventData.reminders && eventData.reminders.length > 0) {
                event.reminders = {
                    useDefault: false,
                    overrides: eventData.reminders,
                }
            }

            // Tag as task if needed
            if (eventData.isTask) {
                event.extendedProperties = {
                    private: {
                        isTask: 'true',
                    },
                }
            }

            const response = await this.calendarService.events.insert({
                calendarId: 'primary',
                requestBody: event,
            })

            console.log(`[Calendar] Created event: ${response.data.id}`)
            return response.data as CalendarEvent
        } catch (error) {
            console.error('[Calendar] Error creating event:', error)
            throw error
        }
    }

    /**
     * Update an existing calendar event
     */
    async updateEvent(
        eventId: string,
        updateData: Partial<{
            summary: string
            description: string
            startDate: string
            endDate: string
            isAllDay: boolean
            recurrence: string[]
            reminders: Array<{ method: 'email' | 'popup'; minutes: number }>
        }>
    ): Promise<CalendarEvent> {
        try {
            console.log('[CalendarProvider] Updating event with ID:', eventId)
            console.log('[CalendarProvider] Update data:', updateData)

            // First get the current event
            const currentEvent = await this.calendarService.events.get({
                calendarId: 'primary',
                eventId: eventId,
            })

            const event = currentEvent.data as calendar_v3.Schema$Event

            // Update fields
            if (updateData.summary) event.summary = updateData.summary
            if (updateData.description) event.description = updateData.description

            if (updateData.startDate || updateData.endDate) {
                if (updateData.isAllDay) {
                    event.start = { date: updateData.startDate || updateData.endDate }
                    event.end = { date: updateData.endDate || updateData.startDate }
                } else {
                    event.start = { dateTime: updateData.startDate || event.start?.dateTime }
                    event.end = { dateTime: updateData.endDate || event.end?.dateTime }
                }
            }

            if (updateData.recurrence) {
                event.recurrence = updateData.recurrence
            }

            if (updateData.reminders) {
                event.reminders = {
                    useDefault: false,
                    overrides: updateData.reminders,
                }
            }

            const response = await this.calendarService.events.update({
                calendarId: 'primary',
                eventId: eventId,
                requestBody: event,
            })

            console.log(`[Calendar] Updated event: ${eventId}`)
            return response.data as CalendarEvent
        } catch (error) {
            console.error('[Calendar] Error updating event:', error)
            throw error
        }
    }

    /**
     * Delete a calendar event
     */
    async deleteEvent(eventId: string): Promise<void> {
        try {
            await this.calendarService.events.delete({
                calendarId: 'primary',
                eventId: eventId,
            })
            console.log(`[Calendar] Deleted event: ${eventId}`)
        } catch (error) {
            console.error('[Calendar] Error deleting event:', error)
            throw error
        }
    }

    /**
     * Get task-related events (those tagged with isTask property)
     */
    async getTaskEvents(startDate: Date, endDate: Date): Promise<CalendarEvent[]> {
        const allEvents = await this.getEventsInRange(startDate, endDate)
        return allEvents.filter((event) => {
            return event.extendedProperties?.private?.isTask === 'true'
        })
    }
}

export default CalendarProvider

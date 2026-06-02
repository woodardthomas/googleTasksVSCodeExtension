/**
 * Utility functions for handling dates, times, and recurring schedules
 * Google Tasks API uses RFC 3339 format for the `due` field
 */

export interface ScheduleInfo {
    dueDateTime?: string // RFC 3339 format: "2025-10-20T14:00:00.000Z"
    recurring?: string // e.g., "daily", "weekly", "monthly"
    recurringDetails?: string // e.g., "every Monday" for display
}

/**
 * Convert a Date object to RFC 3339 format (with time)
 */
export function toRFC3339WithTime(date: Date, hours: number = 9, minutes: number = 0): string {
    const newDate = new Date(date)
    newDate.setHours(hours, minutes, 0, 0)
    return newDate.toISOString()
}

/**
 * Convert a Date object to RFC 3339 format (date only, midnight UTC)
 */
export function toRFC3339DateOnly(date: Date): string {
    const newDate = new Date(date)
    newDate.setHours(0, 0, 0, 0)
    return newDate.toISOString()
}

/**
 * Parse RFC 3339 string to Date object
 */
export function parseRFC3339(dateString: string): Date {
    return new Date(dateString)
}

/**
 * Format date for display (Google Tasks API only stores dates)
 * Returns relative date (Today, Tomorrow, Yesterday) or formatted date with timespan
 */
export function formatDueDate(dueDateTime?: string | null, recurring?: string): string {
    if (!dueDateTime) return ''

    // Parse date-only format (YYYY-MM-DD)
    const dateStr = dueDateTime.split('T')[0] // Get date part only
    const [yearStr, monthStr, dayStr] = dateStr.split('-')
    const year = parseInt(yearStr, 10)
    const month = parseInt(monthStr, 10) - 1 // JavaScript months are 0-indexed
    const day = parseInt(dayStr, 10)

    const dueDate = new Date(year, month, day)
    const today = new Date()

    // Create dates at midnight in local timezone for comparison
    const todayAtMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate())
    const tomorrowAtMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1)
    const yesterdayAtMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1)
    const dueDateAtMidnight = new Date(year, month, day)

    let displayDate = ''
    let daysFromNow = 0
    let isRelativeDate = false

    if (dueDateAtMidnight.getTime() === todayAtMidnight.getTime()) {
        displayDate = 'Today'
        daysFromNow = 0
        isRelativeDate = true
    } else if (dueDateAtMidnight.getTime() === tomorrowAtMidnight.getTime()) {
        displayDate = 'Tomorrow'
        daysFromNow = 1
        isRelativeDate = true
    } else if (dueDateAtMidnight.getTime() === yesterdayAtMidnight.getTime()) {
        displayDate = 'Yesterday'
        daysFromNow = -1
        isRelativeDate = true
    } else {
        // Calculate days from now for timespan
        const diffTime = dueDateAtMidnight.getTime() - todayAtMidnight.getTime()
        daysFromNow = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
        displayDate = `${dueDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
    }

    // Format result
    let result = `📅 ${displayDate}`

    // Add timespan only for dates that aren't relative (Today/Tomorrow/Yesterday)
    if (!isRelativeDate) {
        if (daysFromNow > 0) {
            result += ` (${daysFromNow}d from now)`
        } else if (daysFromNow < 0) {
            result += ` (${Math.abs(daysFromNow)}d ago)`
        }
    }

    if (recurring) {
        result += ` [${recurring}]`
    }

    return result
}

/**
 * Format time in 12-hour format
 */
export function formatTime(hours: number, minutes: number): string {
    const period = hours >= 12 ? 'PM' : 'AM'
    const displayHours = hours % 12 || 12
    return `${displayHours}:${minutes.toString().padStart(2, '0')} ${period}`
}

/**
 * Get time label from hours (morning, afternoon, evening, etc.)
 */
export function getTimeLabel(hours: number): string {
    if (hours < 12) return 'morning'
    if (hours < 17) return 'afternoon'
    return 'evening'
}

/**
 * Common time presets for quick selection
 */
export const TIME_PRESETS = [
    { label: '9:00 AM (Morning)', hours: 9, minutes: 0 },
    { label: '12:00 PM (Noon)', hours: 12, minutes: 0 },
    { label: '2:00 PM (Afternoon)', hours: 14, minutes: 0 },
    { label: '5:00 PM (Evening)', hours: 17, minutes: 0 },
    { label: '9:00 PM (Night)', hours: 21, minutes: 0 },
]

/**
 * Common date presets
 */
export const DATE_PRESETS = [
    {
        label: 'Today',
        getValue: () => {
            const d = new Date()
            return d
        },
    },
    {
        label: 'Tomorrow',
        getValue: () => {
            const d = new Date()
            d.setDate(d.getDate() + 1)
            return d
        },
    },
    {
        label: 'Next Week',
        getValue: () => {
            const d = new Date()
            d.setDate(d.getDate() + 7)
            return d
        },
    },
    {
        label: 'Next Month',
        getValue: () => {
            const d = new Date()
            d.setMonth(d.getMonth() + 1)
            return d
        },
    },
    {
        label: 'This Weekend',
        getValue: () => {
            const d = new Date()
            const day = d.getDay()
            const daysUntilWeekend = (6 - day + 7) % 7 || 6 // Saturday
            d.setDate(d.getDate() + daysUntilWeekend)
            return d
        },
    },
]

/**
 * Recurring schedule presets
 */
export const RECURRING_PRESETS = [
    { label: 'No recurrence', value: undefined },
    { label: 'Daily', value: 'daily' },
    { label: 'Weekly', value: 'weekly' },
    { label: 'Bi-weekly', value: 'biweekly' },
    { label: 'Monthly', value: 'monthly' },
    { label: 'Yearly', value: 'yearly' },
]

/**
 * Parse custom date string (supports formats like YYYY-MM-DD, MM/DD/YYYY, etc.)
 */
export function parseCustomDate(dateString: string): Date | null {
    const trimmed = dateString.trim()

    // Try ISO format YYYY-MM-DD
    let date = new Date(trimmed + 'T00:00:00Z')
    if (!isNaN(date.getTime())) {
        return date
    }

    // Try MM/DD/YYYY or M/D/YYYY
    const slashPattern = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/
    const slashMatch = trimmed.match(slashPattern)
    if (slashMatch) {
        date = new Date(parseInt(slashMatch[3]), parseInt(slashMatch[1]) - 1, parseInt(slashMatch[2]))
        if (!isNaN(date.getTime())) {
            return date
        }
    }

    // Try DD-MM-YYYY or D-M-YYYY
    const dashPattern = /^(\d{1,2})-(\d{1,2})-(\d{4})$/
    const dashMatch = trimmed.match(dashPattern)
    if (dashMatch) {
        date = new Date(parseInt(dashMatch[3]), parseInt(dashMatch[2]) - 1, parseInt(dashMatch[1]))
        if (!isNaN(date.getTime())) {
            return date
        }
    }

    return null
}

/**
 * Parse custom time string (supports 24-hour and 12-hour formats)
 * Returns {hours, minutes} or null if invalid
 */
export function parseCustomTime(timeString: string): { hours: number; minutes: number } | null {
    const trimmed = timeString.trim().toUpperCase()

    // Try 24-hour format HH:MM
    const timePattern24 = /^(\d{1,2}):(\d{2})$/
    const timeMatch24 = trimmed.match(timePattern24)
    if (timeMatch24) {
        let hours = parseInt(timeMatch24[1])
        const minutes = parseInt(timeMatch24[2])
        if (hours >= 0 && hours < 24 && minutes >= 0 && minutes < 60) {
            return { hours, minutes }
        }
    }

    // Try 12-hour format with AM/PM (e.g., "2:30 PM", "9 AM")
    const timePattern12 = /^(\d{1,2}):?(\d{2})?\s*(AM|PM)$/
    const timeMatch12 = trimmed.match(timePattern12)
    if (timeMatch12) {
        let hours = parseInt(timeMatch12[1])
        const minutes = parseInt(timeMatch12[2] || '0')
        const period = timeMatch12[3]

        if (hours < 1 || hours > 12 || minutes < 0 || minutes >= 60) {
            return null
        }

        if (period === 'PM' && hours !== 12) {
            hours += 12
        } else if (period === 'AM' && hours === 12) {
            hours = 0
        }

        return { hours, minutes }
    }

    return null
}

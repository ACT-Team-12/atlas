package com.stephensookra.atlas.services

import android.content.Intent
import android.provider.CalendarContract

/**
 * "Add to my calendar": Android's own new-event screen, filled in. Using the insert intent needs no calendar
 * permission: the person saves the event themselves and ATLAS never reads their calendar.
 */
data class CalendarDraft(val title: String, val startMillis: Long, val quote: String, val detail: String, val minutes: Int = 60) {
    val endMillis: Long get() = startMillis + minutes * 60_000L

    /** Same idea as the web .ics: the line from the paper rides along with the event. */
    val notes: String get() = buildList {
        if (detail.isNotBlank()) add(detail)
        if (quote.isNotBlank()) add("Your paper says: \"$quote\"")
        add("From ATLAS. Not medical advice.")
    }.joinToString("\n\n")

    fun intent(): Intent = Intent(Intent.ACTION_INSERT).setData(CalendarContract.Events.CONTENT_URI)
        .putExtra(CalendarContract.Events.TITLE, title)
        .putExtra(CalendarContract.Events.DESCRIPTION, notes)
        .putExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, startMillis)
        .putExtra(CalendarContract.EXTRA_EVENT_END_TIME, endMillis)
}

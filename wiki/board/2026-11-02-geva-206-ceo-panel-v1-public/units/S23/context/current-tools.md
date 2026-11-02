# Staff tools

The administration service already offers a CSV download for a selected date range. Staff use it to print collection lists during busy weeks. It includes collection date, slot start, household reference and reserved parcel count, with one row per booking sorted by date, start time and household reference.

The implementation is in src/roster.py. It accepts the same reservation record structure used by current bookings and by the planned change-of-day operation. Its current download action can be placed in another staff area without a new commercial license or supplier change.

The roster has been in regular use for ten months. Staff have not requested any extra columns for the repair. They want it next to the day-change controls so agents do not need to navigate to a separate report page.

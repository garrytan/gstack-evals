import csv
import io


def build_roster(reservations):
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["collection_date", "slot_start", "household_ref", "reserved_count"])
    ordered = sorted(
        reservations,
        key=lambda row: (row["collection_date"], row["slot_start"], row["household_ref"]),
    )
    for row in ordered:
        writer.writerow([
            row["collection_date"],
            row["slot_start"],
            row["household_ref"],
            row["reserved_count"],
        ])
    return output.getvalue()

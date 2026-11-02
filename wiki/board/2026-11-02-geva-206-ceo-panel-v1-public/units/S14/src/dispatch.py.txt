from dataclasses import dataclass
from uuid import uuid4


@dataclass
class Route:
    id: str
    district: str
    day: str
    remaining: int


class Collections:
    def __init__(self, routes):
        self.routes = {route.id: route for route in routes}
        self.bookings = {}

    def reserve(self, shop, district, day, crates):
        route = next(r for r in self.routes.values()
                     if r.district == district and r.day == day
                     and r.remaining >= crates)
        identifier = str(uuid4())
        route.remaining -= crates
        record = dict(id=identifier, shop=shop, route=route.id,
                      district=district, day=day, crates=crates)
        self.bookings[identifier] = record
        return dict(record)

    def cancel(self, identifier):
        record = self.bookings.pop(identifier)
        self.routes[record['route']].remaining += record['crates']
        return record

    def reschedule(self, identifier, day):
        record = self.bookings[identifier]
        replacement = self.reserve(record['shop'], record['district'], day,
                                   record['crates'])
        self.cancel(identifier)
        return replacement

    def manifest(self, route):
        return [dict(b) for b in self.bookings.values() if b['route'] == route]

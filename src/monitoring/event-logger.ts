export class EventLogger {
  private events: any[] = [];
  log(event: Record<string, unknown>) {
    this.events.push({ timestamp: new Date().toISOString(), ...event });
    if (this.events.length > 1000) this.events.shift();
  }
  getEvents(limit = 100) { return this.events.slice(-limit); }
  query(filter: (e: any) => boolean) { return this.events.filter(filter); }
}

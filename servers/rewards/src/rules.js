// The rules of TizCat Rewards, apart from storage, so tests can check them:
// how many points an event earns, and whether a device is over its daily
// limit. The numbers come from the live config (config.json "rewards").

export function pointsFor(config, placement, kind) {
  const table = (config.rewards && config.rewards.points) || {};
  const points = table[`${placement}.${kind}`];
  return Number.isInteger(points) && points > 0 ? points : 0;
}

export function utcDay(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

export function overDailyLimit(config, eventsToday) {
  const cap = (config.rewards && config.rewards.dailyEventsPerDevice) || 0;
  return cap > 0 && eventsToday >= cap;
}

// Utilitats de dates compartides entre el mòdul de planificació, el client
// d'AimHarder i el scheduler. weekday: 0=diumenge ... 6=dissabte (Date.getDay()).

export function combineDateAndTime(date: Date, time: string): Date {
  const [hours, minutes] = time.split(":").map(Number);
  const result = new Date(date);
  result.setHours(hours, minutes, 0, 0);
  return result;
}

export function toISODate(date: Date): string {
  return (
    date.getFullYear().toString().padStart(4, "0") +
    "-" +
    String(date.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(date.getDate()).padStart(2, "0")
  );
}

export function toAimharderDay(isoDate: string): string {
  return isoDate.replaceAll("-", "");
}

/**
 * Retorna la data (avui inclòs, sense mirar l'hora) dins els propers 7 dies
 * que cau en `weekday`. Fa servir el mateix criteri que la tira de dies del
 * frontend (avui + 6 dies), per llistar les classes d'un dia concret.
 */
export function calendarDateForWeekday(weekday: number, from = new Date()): Date {
  const base = new Date(from);
  base.setHours(0, 0, 0, 0);
  for (let offset = 0; offset < 7; offset++) {
    const candidate = new Date(base);
    candidate.setDate(base.getDate() + offset);
    if (candidate.getDay() === weekday) return candidate;
  }
  return base; // inabastable, weekday és sempre 0-6
}

/**
 * Retorna la propera data (avui inclòs) que cau en `weekday` i la seva
 * classe encara no ha començat. Si avui és el dia però la classe ja ha
 * passat, retorna el mateix dia de la setmana següent.
 */
export function nextOccurrence(weekday: number, time: string, from = new Date()): Date {
  const base = new Date(from);
  base.setHours(0, 0, 0, 0);
  for (let offset = 0; offset < 8; offset++) {
    const candidate = new Date(base);
    candidate.setDate(base.getDate() + offset);
    if (candidate.getDay() !== weekday) continue;
    const classDateTime = combineDateAndTime(candidate, time);
    if (classDateTime.getTime() > from.getTime()) {
      return candidate;
    }
  }
  // No hauria de passar mai (en 7 dies sempre hi ha una ocurrència futura),
  // però per seguretat retornem la setmana següent del mateix weekday.
  const fallback = new Date(base);
  fallback.setDate(base.getDate() + 7);
  return fallback;
}

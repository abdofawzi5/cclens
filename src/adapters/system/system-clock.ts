import type { Clock } from '../../core/ports/infrastructure.js';

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

import * as core from "@actions/core";

/**
 * The `enable-annotation` gate. Held here rather than threaded through every
 * reporting call because a missed call site is invisible — it posts an
 * annotation the caller turned off, and nothing fails. Defaults to off so a
 * message emitted before the input is read degrades the same way.
 */
let enabled = false;

export const setAnnotationsEnabled = (value: boolean): void => {
  enabled = value;
};

/**
 * `core.warning` both logs and annotates, so a gated message has no log line of
 * its own to fall back on — hence the degrade rather than a skip.
 */
export const warn = (message: string, title?: string): void => {
  if (enabled) {
    core.warning(message, { title });
    return;
  }
  core.info(message);
};

/** For a message the caller has already logged: only the annotation is gated. */
export const notice = (message: string, title?: string): void => {
  if (enabled) {
    core.notice(message, { title });
  }
};

// Follow and free-scroll modes for a viewer's terminal (`viewer-experience`: Follow and
// free-scroll modes). Pure state transitions; the terminal pane feeds it scroll and output events.

export interface FollowState {
  /** True while the view sticks to the latest output. */
  following: boolean;
  /** True when output arrived while scrolled back; shown as "new output". */
  newOutput: boolean;
}

export const initialFollow: FollowState = { following: true, newOutput: false };

/** The viewer scrolled; `atBottom` says whether the view now shows the latest line. */
export function onScroll(state: FollowState, atBottom: boolean): FollowState {
  if (atBottom) return { following: true, newOutput: false };
  return state.following ? { following: false, newOutput: false } : state;
}

/** New output arrived. */
export function onOutput(state: FollowState): FollowState {
  return state.following || state.newOutput ? state : { ...state, newOutput: true };
}

/** The viewer jumped somewhere (a prompt, a search match): stop following. */
export function onJump(): FollowState {
  return { following: false, newOutput: false };
}

/** The viewer chose to follow the live output again. */
export function followAgain(): FollowState {
  return { following: true, newOutput: false };
}

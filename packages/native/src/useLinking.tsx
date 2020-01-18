import * as React from 'react';
import {
  getStateFromPath as getStateFromPathDefault,
  getPathFromState as getPathFromStateDefault,
  NavigationContainerRef,
  NavigationState,
  getActionFromState,
} from '@react-navigation/core';

type GetStateFromPath = typeof getStateFromPathDefault;
type GetPathFromState = typeof getPathFromStateDefault;

type Config = Parameters<GetStateFromPath>[1];

type Options = {
  /**
   * The prefixes are stripped from the URL before parsing them.
   * Usually they are the `scheme` + `host` (e.g. `myapp://chat?user=jane`)
   */
  prefixes: string[];
  /**
   * Config to fine-tune how to parse the path.
   *
   * Example:
   * ```js
   * {
   *   Chat: {
   *     path: 'chat/:author/:id',
   *     parse: { id: Number }
   *   }
   * }
   * ```
   */
  config?: Config;
  /**
   * Custom function to parse the URL to a valid navigation state (advanced).
   */
  getStateFromPath?: GetStateFromPath;
  /**
   * Custom function to conver the state object to a valid URL (advanced).
   */
  getPathFromState?: GetPathFromState;
};

const getStateLength = (state: NavigationState) => {
  let length = 0;

  if (state.history) {
    length = state.history.length;
  } else {
    length = state.index + 1;
  }

  const focusedState = state.routes[state.index].state;

  if (focusedState && !focusedState.stale) {
    // If the focused route has history entries, we need to count them as well
    length += getStateLength(focusedState as NavigationState) - 1;
  }

  return length;
};

export default function useLinking(
  ref: React.RefObject<NavigationContainerRef>,
  {
    prefixes,
    config,
    getStateFromPath = getStateFromPathDefault,
    getPathFromState = getPathFromStateDefault,
  }: Options
) {
  // We store these options in ref to avoid re-creating getInitialState and re-subscribing listeners
  // This lets user avoid wrapping the items in `React.useCallback` or `React.useMemo`
  // Not re-creating `getInitialState` is important coz it makes it easier for the user to use in an effect
  const prefixesRef = React.useRef(prefixes);
  const configRef = React.useRef(config);
  const getStateFromPathRef = React.useRef(getStateFromPath);
  const getPathFromStateRef = React.useRef(getPathFromState);

  React.useEffect(() => {
    prefixesRef.current = prefixes;
    configRef.current = config;
    getStateFromPathRef.current = getStateFromPath;
    getPathFromStateRef.current = getPathFromState;
  }, [config, getPathFromState, getStateFromPath, prefixes]);

  const getInitialState = React.useCallback(() => {
    const path = location.pathname + location.search;

    if (path) {
      return getStateFromPathRef.current(path, configRef.current);
    } else {
      return undefined;
    }
  }, []);

  const previousStateLengthRef = React.useRef<number | undefined>(undefined);
  const previousHistoryIndexRef = React.useRef(0);

  const pendingIndexChangeRef = React.useRef<number | undefined>();
  const pendingStateUpdateRef = React.useRef<boolean>(false);

  React.useEffect(() => {
    window.addEventListener('popstate', () => {
      const navigation = ref.current;

      if (!navigation) {
        return;
      }

      const previousHistoryIndex = previousHistoryIndexRef.current;
      const historyIndex = history.state?.index ?? 0;

      previousHistoryIndexRef.current = historyIndex;

      if (pendingIndexChangeRef.current === historyIndex) {
        pendingIndexChangeRef.current = undefined;
        return;
      }

      const state = navigation.getRootState();
      const path = getPathFromStateRef.current(state, configRef.current);

      if (previousHistoryIndex === historyIndex) {
        if (location.pathname + location.search !== path) {
          pendingStateUpdateRef.current = true;
          history.replaceState(null, '', path);
        }
      } else if (previousHistoryIndex === historyIndex + 1) {
        pendingStateUpdateRef.current = true;
        navigation.goBack();
      } else if (previousHistoryIndex === historyIndex - 1) {
        const state = getStateFromPathRef.current(
          location.pathname + location.search,
          configRef.current
        );

        if (state) {
          const action = getActionFromState(state);

          pendingStateUpdateRef.current = true;

          if (action.type === 'RESET_ROOT') {
            navigation.resetRoot(action.payload);
          } else {
            navigation.dispatch(action);
          }
        }
      } else {
        // TODO
      }
    });
  }, [ref]);

  React.useEffect(() => {
    if (ref.current && previousStateLengthRef.current === undefined) {
      previousStateLengthRef.current = getStateLength(
        ref.current.getRootState()
      );
    }

    const unsubscribe = ref.current?.addListener('state', () => {
      const navigation = ref.current;

      if (!navigation) {
        return;
      }

      const state = navigation.getRootState();
      const path = getPathFromStateRef.current(state, configRef.current);

      if (
        pendingStateUpdateRef.current &&
        location.pathname + location.search === path
      ) {
        pendingStateUpdateRef.current = false;
        return;
      }

      const previousStateLength = previousStateLengthRef.current ?? 1;
      const stateLength = getStateLength(state);

      previousStateLengthRef.current = stateLength;

      let index = history.state?.index ?? 0;

      if (previousStateLength === stateLength) {
        // If no new enrties were added to history in our navigation state, we want to replaceState
        if (location.pathname + location.search !== path) {
          history.replaceState({ index }, '', path);
          previousHistoryIndexRef.current = index;
        }
      } else if (stateLength > previousStateLength) {
        // If new enrties were added, pushState until we have same length
        // This won't be accurate if multiple enrties were added at once, but that's the best we can do
        for (let i = 0, l = stateLength - previousStateLength; i < l; i++) {
          index++;
          history.pushState({ index }, '', path);
        }

        previousHistoryIndexRef.current = index;
      } else if (previousStateLength > stateLength) {
        const delta = previousStateLength - stateLength;

        // We need to set this to ignore the `popstate` event
        pendingIndexChangeRef.current = index - delta;

        // If new enrties were removed, go back so that we have same length
        history.go(-delta);
      }
    });

    return unsubscribe;
  });

  return {
    getInitialState,
  };
}

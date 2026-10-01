import { beforeEach, describe, expect, it } from 'vitest';
import { useUiStore } from './uiStore';

describe('uiStore', () => {
  beforeEach(() => {
    useUiStore.setState({ sidebarExpanded: true, notices: [] });
  });

  it('toggles the sidebar', () => {
    expect(useUiStore.getState().sidebarExpanded).toBe(true);
    useUiStore.getState().toggleSidebar();
    expect(useUiStore.getState().sidebarExpanded).toBe(false);
  });

  it('adds and dismisses notices', () => {
    useUiStore.getState().pushNotice({ tone: 'info', message: 'hello' });
    const [notice] = useUiStore.getState().notices;
    expect(notice?.message).toBe('hello');
    expect(notice?.id).toBeTruthy();

    useUiStore.getState().dismissNotice(notice!.id);
    expect(useUiStore.getState().notices).toHaveLength(0);
  });
});

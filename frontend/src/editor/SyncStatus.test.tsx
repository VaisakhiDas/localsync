import type { SyncSnapshot } from '@localsync/shared/sync';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { OfflineNotice, SyncStatus } from './SyncStatus';

const snap = (over: Partial<SyncSnapshot>): SyncSnapshot => ({ phase: 'offline', connected: false, upToDate: false, readOnly: false, denied: null, ...over });

describe('SyncStatus', () => {
  it.each([
    ['offline', 'Offline'],
    ['connecting', 'Connecting'],
    ['syncing', 'Syncing'],
    ['synced', 'Synced'],
    ['denied', 'No access'],
  ] as const)('shows %s as "%s" in a polite live region', (phase, label) => {
    render(<SyncStatus snapshot={snap({ phase })} enabled />);
    const chip = screen.getByRole('status');
    expect(chip).toHaveTextContent(label);
    expect(chip).toHaveAttribute('aria-live', 'polite');
    expect(chip).toHaveAttribute('data-sync-phase', phase);
  });

  it('explains a refusal differently for an expired sign-in and for missing permission', () => {
    const { rerender } = render(<SyncStatus snapshot={snap({ phase: 'denied', denied: { code: 4401, reason: '' } })} enabled />);
    expect(screen.getByRole('status')).toHaveAttribute('title', expect.stringMatching(/sign-in is no longer valid/i));
    rerender(<SyncStatus snapshot={snap({ phase: 'denied', denied: { code: 4403, reason: '' } })} enabled />);
    expect(screen.getByRole('status')).toHaveAttribute('title', expect.stringMatching(/do not have access/i));
  });

  it('says the document has not been uploaded yet when synchronisation is not enabled for it', () => {
    render(<SyncStatus snapshot={snap({})} enabled={false} />);
    expect(screen.getByRole('status')).toHaveTextContent('Not uploaded yet');
  });

  it('never claims "Synced" for any phase other than synced', () => {
    for (const phase of ['offline', 'connecting', 'syncing', 'denied'] as const) {
      const { unmount } = render(<SyncStatus snapshot={snap({ phase })} enabled />);
      expect(screen.getByRole('status')).not.toHaveTextContent(/^Synced$/);
      unmount();
    }
  });
});

describe('OfflineNotice', () => {
  it('appears only while offline, and tells the user their work is safe', () => {
    const { rerender, container } = render(<OfflineNotice snapshot={snap({ phase: 'offline' })} enabled />);
    expect(container).toHaveTextContent(/saved on this device/i);
    rerender(<OfflineNotice snapshot={snap({ phase: 'synced' })} enabled />);
    expect(container).toBeEmptyDOMElement();
    rerender(<OfflineNotice snapshot={snap({ phase: 'offline' })} enabled={false} />);
    expect(container).toBeEmptyDOMElement(); // an un-uploaded document is not "offline", it just has not been uploaded
  });
});

import {
  beginWrite,
  currentWriteRevision,
  mergePendingWrites,
  pendingWriteCount,
  pendingWriteRequests,
} from './pending-writes';

describe('unacknowledged write protection', () => {
  it('preserves a failed save over stale GET data and isolates accounts', () => {
    beginWrite('pending-alice', '/api/favorites', {
      method: 'POST',
      body: JSON.stringify({ key: 'a+1', favorite: { title: 'New' } }),
    });
    expect(
      mergePendingWrites(
        'pending-alice',
        '/api/favorites',
        {},
        currentWriteRevision()
      )
    ).toEqual({ 'a+1': { title: 'New' } });
    expect(mergePendingWrites('pending-bob', '/api/favorites', {}, 0)).toEqual(
      {}
    );
    expect(pendingWriteCount('pending-alice')).toBe(1);
  });
  it('does not resurrect a pending deletion or acknowledge a newer intent', () => {
    const oldAck = beginWrite('delete-user', '/api/favorites', {
      method: 'POST',
      body: JSON.stringify({ key: 'a+1', favorite: { title: 'Old' } }),
    });
    beginWrite('delete-user', '/api/favorites?key=a%2B1', { method: 'DELETE' });
    oldAck?.();
    expect(pendingWriteCount('delete-user')).toBe(1);
    expect(
      mergePendingWrites(
        'delete-user',
        '/api/favorites',
        { 'a+1': { title: 'Old' }, 'b+2': {} },
        currentWriteRevision()
      )
    ).toEqual({ 'b+2': {} });
  });
  it('overlays a confirmed write only on reads that started before it', () => {
    const before = currentWriteRevision();
    const ack = beginWrite('confirmed-user', '/api/playrecords', {
      method: 'POST',
      body: JSON.stringify({ key: 'a+1', record: { title: 'Progress' } }),
    });
    ack?.();
    expect(pendingWriteCount('confirmed-user')).toBe(0);
    expect(
      mergePendingWrites('confirmed-user', '/api/playrecords', {}, before)
    ).toEqual({ 'a+1': { title: 'Progress' } });
    expect(
      mergePendingWrites(
        'confirmed-user',
        '/api/playrecords',
        {},
        currentWriteRevision()
      )
    ).toEqual({});
  });
  it('preserves ordered search history intents including clear', () => {
    beginWrite('history-user', '/api/searchhistory', { method: 'DELETE' });
    beginWrite('history-user', '/api/searchhistory', {
      method: 'POST',
      body: JSON.stringify({ keyword: 'new' }),
    });
    expect(
      mergePendingWrites('history-user', '/api/searchhistory', ['old'], 0)
    ).toEqual(['new']);
  });
  it('does not replay a clear-all intent against subsequently saved data', () => {
    beginWrite('clear-user', '/api/searchhistory', { method: 'DELETE' });
    const ack = beginWrite('clear-user', '/api/searchhistory', {
      method: 'POST',
      body: JSON.stringify({ keyword: 'newer' }),
    });
    ack?.();
    expect(
      mergePendingWrites(
        'clear-user',
        '/api/searchhistory',
        ['old', 'newer'],
        currentWriteRevision()
      )
    ).toEqual(['newer']);
    expect(pendingWriteRequests('clear-user')).toEqual([]);
    const persisted = JSON.parse(
      localStorage.getItem('moontv_pending_writes_v1_clear-user') || '{}'
    );
    expect(persisted['/api/searchhistory:newer'].pending).toBe(false);
  });
  it('does not turn malformed cached intents into API requests', () => {
    localStorage.setItem(
      'moontv_pending_writes_v1_malformed',
      JSON.stringify({
        '/api/admin/user:alice': {
          pending: true,
          method: 'DELETE',
          key: 'alice',
          revision: 1,
        },
        '/api/favorites:bad': null,
      })
    );
    expect(pendingWriteRequests('malformed')).toEqual([]);
  });
  it('reloads pending intents and confirmed successors of an unresolved clear', () => {
    localStorage.setItem(
      'moontv_pending_writes_v1_reloaded',
      JSON.stringify({
        '/api/searchhistory:': {
          key: '',
          method: 'DELETE',
          revision: 1,
          pending: true,
          value: null,
        },
        '/api/searchhistory:new': {
          key: 'new',
          method: 'POST',
          revision: 2,
          pending: false,
          value: 'new',
        },
      })
    );
    expect(
      mergePendingWrites(
        'reloaded',
        '/api/searchhistory',
        ['old', 'new'],
        currentWriteRevision()
      )
    ).toEqual(['new']);
    expect(pendingWriteCount('reloaded')).toBe(1);
  });
  it('marks the latest intent uncertain if an older acknowledgement arrives last', () => {
    const oldAck = beginWrite('reverse-order', '/api/playrecords', {
      method: 'POST',
      body: JSON.stringify({ key: 'a+1', record: { play_time: 10 } }),
    });
    const newAck = beginWrite('reverse-order', '/api/playrecords', {
      method: 'POST',
      body: JSON.stringify({ key: 'a+1', record: { play_time: 20 } }),
    });
    newAck?.();
    oldAck?.();
    expect(pendingWriteCount('reverse-order')).toBe(1);
    expect(
      mergePendingWrites(
        'reverse-order',
        '/api/playrecords',
        { 'a+1': { play_time: 10 } },
        currentWriteRevision()
      )
    ).toEqual({ 'a+1': { play_time: 20 } });
  });
  it('does not let a late clear-all acknowledgement hide a newer successful save', () => {
    const clearAck = beginWrite('late-clear', '/api/favorites', {
      method: 'DELETE',
    });
    const saveAck = beginWrite('late-clear', '/api/favorites', {
      method: 'POST',
      body: JSON.stringify({ key: 'a+1', favorite: { title: 'New' } }),
    });
    saveAck?.();
    clearAck?.();
    expect(pendingWriteCount('late-clear')).toBe(1);
    expect(
      mergePendingWrites(
        'late-clear',
        '/api/favorites',
        {},
        currentWriteRevision()
      )
    ).toEqual({ 'a+1': { title: 'New' } });
  });
});

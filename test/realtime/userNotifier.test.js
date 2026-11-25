const test = require('node:test');
const assert = require('node:assert/strict');
const { createUserNotifier } = require('../../src/realtime/userNotifier');

const fakeSocket = () => {
  const received = [];
  return { received, send: (data) => received.push(JSON.parse(data)) };
};

test('el aviso llega a todas las conexiones del usuario y solo a él', () => {
  const notifier = createUserNotifier({ logger: { warn() {} } });
  const tab1 = fakeSocket();
  const tab2 = fakeSocket();
  const other = fakeSocket();
  notifier.subscribe('ana', tab1);
  notifier.subscribe('ana', tab2);
  notifier.subscribe('luis', other);

  assert.equal(notifier.notify('ana', { type: 'project-shared' }), 2);
  assert.equal(tab1.received.length, 1);
  assert.equal(tab2.received.length, 1);
  assert.equal(other.received.length, 0);

  notifier.unsubscribe('ana', tab1);
  notifier.unsubscribe('ana', tab2);
  assert.equal(notifier.notify('ana', { type: 'project-shared' }), 0);
});

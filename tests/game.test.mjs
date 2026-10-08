import assert from 'node:assert/strict';
import { test } from 'node:test';
import { newBoard, play, position, statusText } from '../src/game.ts';

const after = (moves) => moves.reduce(play, newBoard());
test('new games are independent, X starts, and moves do not mutate their input', () => {
  const board = Object.freeze(newBoard());
  assert.notEqual(newBoard(), newBoard());
  assert.equal(statusText(position(board)), 'X to play');
  const next = play(board, 4);
  assert.equal(board[4], null);
  assert.equal(next[4], 'X');
  assert.equal(statusText(position(next)), 'O to play');
  for (const cell of [-1, 9, NaN, Infinity, 1.2]) assert.equal(play(board, cell), board);
  assert.equal(play(next, 4), next);
});
test('a ninth move can complete two lines; won and drawn boards accept no further moves', () => {
  const board = after([1,4,2,5,3,7,6,8,0]);
  assert.equal(statusText(position(board)), 'X wins');
  assert.deepEqual([...position(board).winningCells].sort(), [0,1,2,3,6]);
  const draw = after([0,1,2,4,3,5,7,6,8]);
  assert.equal(statusText(position(draw)), 'Draw');
  assert.deepEqual(position(draw).winningCells, []);
  for (let i=0; i<9; i++) {
    assert.equal(play(board, i), board);
    assert.equal(play(draw, i), draw);
  }
});
test('all possible legal game histories end at the first win or draw', () => {
  // Independent row/column/diagonal oracle, not the engine's line table.
  function winner(b) {
    for (const p of ['X', 'O']) {
      for (let i=0; i<3; i++) {
        if ([0,1,2].every(j => b[3*i+j] === p)) return p;
        if ([0,1,2].every(j => b[3*j+i] === p)) return p;
      }
      if ([0,4,8].every(i => b[i] === p) || [2,4,6].every(i => b[i] === p)) return p;
    }
    return null;
  }
  const ends = {X: 0, O: 0, draw: 0};
  function visit(board, depth) {
    const actual = position(board);
    const win = winner(board);
    if (win || depth === 9) {
      assert.equal(actual.kind, win ? 'won' : 'draw');
      if (win) assert.equal(actual.winner, win);
      ends[win ?? 'draw']++;
      for (let i=0; i<9; i++) assert.equal(play(board, i), board);
      return;
    }
    assert.equal(actual.kind, 'playing');
    assert.equal(actual.next, depth % 2 ? 'O' : 'X');
    for (let i=0; i<9; i++) if (board[i] === null) {
      const next = play(board, i);
      assert.equal(next.filter(x => x !== null).length, depth+1);
      visit(next, depth+1);
    }
  }
  visit(newBoard(), 0);
  assert.deepEqual(ends, { X: 131184, O: 77904, draw: 46080 });
});

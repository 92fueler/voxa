import { describe, expect, it } from 'vitest';
import { initialTurnPreference as initial, turnPreference } from './turn-style';

describe('conservative conversational pacing intent', () => {
  it.each(['Mock interview me.', "Let's practice a behavioral interview", 'Help me learn distributed systems', 'Let me explain my system design', '帮我学习系统设计', '我们来模拟面试'])('recognizes an activity request: %s', text => {
    expect(turnPreference(text, initial)).toEqual({ style: 'thinking', locked: false });
  });
  it.each(['What is a load balancer?', 'I saw an interview today', 'I use a database at work', "Don't mock interview me", '不要模拟面试', 'What does “mock interview me” mean?'])('does not switch on a topic, negation or quote: %s', text => {
    expect(turnPreference(text, initial)).toBe(initial);
  });
  it('keeps automatic thinking pace until a clear activity transition', () => {
    const thinking = turnPreference('Help me learn databases', initial);
    expect(turnPreference('What about indexes?', thinking)).toBe(thinking);
    expect(turnPreference("Let's just chat", thinking)).toEqual(initial);
    expect(turnPreference('随便聊聊', thinking)).toEqual(initial);
  });
  it('lets explicit preferences win until automatic mode is restored', () => {
    const normal = turnPreference('Please use normal conversation.', initial);
    expect(normal).toEqual({ style: 'everyday', locked: true });
    expect(turnPreference('Mock interview me', normal)).toBe(normal);
    const automatic = turnPreference('Use automatic turn-taking', normal);
    expect(turnPreference('Mock interview me', automatic).style).toBe('thinking');
    const thinking = turnPreference('给我更多思考时间', initial);
    expect(thinking).toEqual({ style: 'thinking', locked: true });
    expect(turnPreference("Let's just chat", thinking)).toBe(thinking);
  });
});

it.each(['Can we practice system design?', "Let's design a URL shortener", 'I have a technical question', '我们来设计一个聊天系统'])('recognizes a clear technical activity: %s', text => {
  expect(turnPreference(text, initial).style).toBe('thinking');
});

it('accepts polite standalone overrides without treating embedded examples as commands', () => {
  expect(turnPreference('Can you give me more thinking time, please?', initial)).toEqual({ style: 'thinking', locked: true });
  expect(turnPreference('What if I say give me more thinking time?', initial)).toBe(initial);
});

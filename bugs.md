# Bug Report

A comprehensive audit of the qwen-code repository. Each bug below has been verified by reading the actual source code.

---

## Bug 1: `stdinDoesNotEnd` option is broken — stdin always closed

**File:** `integration-tests/test-helper.ts:279`

```typescript
if (
  typeof promptOrOptions === 'object' &&
  !promptOrOptions.stdinDoesNotEnd
) {
  child.stdin!.end();   // line 277 — conditional close
}
child.stdin!.end();     // line 279 — ALWAYS closes, unconditionally
```

**Impact:** The `stdinDoesNotEnd` option is completely non-functional. Even when a test sets `stdinDoesNotEnd: true` to keep stdin open for streaming input, stdin is immediately closed by the unconditional call on line 279. Tests that rely on keeping stdin open will silently malfunction.

---

## Bug 2: Docker image tag becomes `":undefined"` when image name has no colon

**File:** `scripts/build_sandbox.js:138-139`

```javascript
const imageTag =
  process.env.QWEN_SANDBOX_IMAGE_TAG || imageName.split(':')[1];
const finalImageName = `${imageName.split(':')[0]}:${imageTag}`;
```

**Impact:** If `imageName` does not contain a colon (e.g. `"myimage"`), then `split(':')[1]` returns `undefined`. Without `QWEN_SANDBOX_IMAGE_TAG` set, `imageTag` is `undefined`, producing a malformed image name like `"myimage:undefined"`. The Docker/Podman build command will fail with a confusing error.

---

## Bug 3: `schema.description += ...` concatenates to `undefined`

**File:** `scripts/generate-settings-schema.ts:124`

```typescript
// line 97: const schema: JsonSchemaProperty = {};
// line 99-101: schema.description is only set if setting.description is truthy

schema.description +=
  ' Options: ' + setting.options.map((o) => `${o.value}`).join(', ');
```

**Impact:** When a setting of type `enum` has no `description`, `schema.description` is `undefined`. Using `+=` produces the string `"undefined Options: foo, bar"` instead of `" Options: foo, bar"`. The generated JSON schema will contain corrupt descriptions.

---

## Bug 4: `bundle` directory deleted twice in clean script

**File:** `scripts/clean.js:30,36`

```javascript
rmSync(join(root, 'bundle'), { recursive: true, force: true });     // line 30
rmSync(join(root, 'packages/cli/src/generated/'), { ... });
const RMRF_OPTIONS = { recursive: true, force: true };
rmSync(join(root, 'bundle'), RMRF_OPTIONS);                         // line 36 — duplicate!
```

**Impact:** Copy-paste error. The second `rmSync` on line 36 deletes `bundle` again (already deleted on line 30). The `RMRF_OPTIONS` constant was likely introduced to clean a different directory, but the path was never updated.

---

## Bug 5: `findBreakPoint` misses valid break points at position 0

**File:** `packages/channels/base/src/BlockStreamer.ts:119-124`

```typescript
private findBreakPoint(text: string, maxPos: number): number {
  const sub = text.slice(0, maxPos);
  const para = sub.lastIndexOf('\n\n');
  if (para > 0) return para + 2;      // BUG: should be >= 0
  const nl = sub.lastIndexOf('\n');
  if (nl > 0) return nl + 1;          // BUG: should be >= 0
  const sp = sub.lastIndexOf(' ');
  if (sp > 0) return sp + 1;          // BUG: should be >= 0
  return maxPos;
}
```

**Impact:** `lastIndexOf` returns `0` when the match is at the start of the string, but `> 0` rejects position 0. When a paragraph break, newline, or space occurs at the very beginning of the text buffer, the code fails to find it as a valid break point and falls through to `maxPos`, producing suboptimal chunk splitting in streamed messages.

---

## Bug 6: Autocomplete searches wrong text range when cursor is at position 0

**File:** `packages/vscode-ide-companion/src/webview/hooks/useCompletionTrigger.ts:297-298`

```typescript
const effectiveCursorPosition =
  cursorPosition === 0 && text.length > 0 ? text.length : cursorPosition;
```

**Impact:** When the cursor is at position 0 (beginning of the input) and there is text, the code moves `effectiveCursorPosition` to the END of the text. This causes the trigger detection (`textBeforeCursor = text.substring(0, effectiveCursorPosition)`) to search the entire text content instead of just the text before the cursor. Users typing `@` or `/` at the start of a message will get incorrect autocomplete suggestions based on content that appears after their cursor.

---

## Bug 7: Telegram HTML fallback sends entire message instead of plain-text chunk

**File:** `packages/channels/telegram/src/TelegramAdapter.ts:182-195`

```typescript
async sendMessage(chatId: string, text: string): Promise<void> {
  const html = telegramFormat(text);
  const chunks = splitHtmlForTelegram(html);
  for (const chunk of chunks) {
    try {
      await this.bot.api.sendMessage(chatId, chunk, { parse_mode: 'HTML' });
    } catch {
      await this.bot.api.sendMessage(chatId, text);  // BUG: sends entire `text`, not the chunk
      return;
    }
  }
}
```

**Impact:** When Telegram rejects an HTML chunk (e.g. due to malformed tags), the fallback sends the entire original `text` as a single plain-text message, not just the current chunk. For long messages that were split into multiple chunks, this results in the user receiving a partial set of HTML chunks followed by the entire message in plain text — duplicating content and potentially exceeding Telegram's message size limits.

---

## Bug 8: PNG detection only checks 3 of 4 magic bytes

**File:** `packages/channels/weixin/src/WeixinAdapter.ts:208`

```typescript
function detectImageMime(data: Buffer): string {
  if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e) {
    return 'image/png';   // Only checks 3 bytes: 89 50 4E
  }
  // ...
  if (data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46) {
    // WebP checks 4 bytes correctly
```

**Impact:** The PNG magic bytes are `89 50 4E 47` (4 bytes). The code only checks the first 3, missing the final `0x47` ('G'). Any file starting with `\x89PN` (not just `\x89PNG`) would be incorrectly identified as PNG. Other format checks in the same function (e.g. WebP/RIFF) correctly check 4 bytes, making this an inconsistency.

---

## Bug 9: Inconsistent offset-to-position conversion between start and end calculations

**File:** `packages/cli/src/ui/components/shared/text-buffer.ts:379,391`

```typescript
// START position — always adds +1 for newline (even on last line)
const lineLength = lines[i].length + 1;
if (offset + lineLength > startOffset) { ... }

// END position — only adds +1 for newline on non-last lines
const lineLength = lines[i].length + (i < lines.length - 1 ? 1 : 0);
if (offset + lineLength >= endOffset) { ... }
```

**Impact:** The start calculation always assumes a trailing newline (even on the last line), while the end calculation does not. Combined with different comparison operators (`>` vs `>=`), this creates an asymmetry at line boundaries. For a two-line document `"abc\ndef"`, an end offset of 4 (the newline position) resolves to `{row: 0, col: 4}` — but row 0 only has 3 characters. This causes incorrect cursor positioning and selection ranges at line boundaries.

---

## Bug 10: `LruCache.get()` fails to reorder when value is falsy

**File:** `packages/core/src/utils/LruCache.ts:16-24`

```typescript
get(key: K): V | undefined {
  const value = this.cache.get(key);
  if (value) {                    // BUG: truthy check, not existence check
    this.cache.delete(key);
    this.cache.set(key, value);
  }
  return value;
}
```

**Impact:** When a cached value is falsy (`0`, `''`, `false`, `null`), the LRU reordering step is skipped. The value is still returned correctly, but it remains in its original insertion-order position instead of being moved to the most-recently-used end. A legitimate falsy value will therefore be evicted earlier than it should be, breaking the LRU invariant. The correct check is `if (value !== undefined)` or `if (this.cache.has(key))`.

---

## Bug 11: Default dispatch mode `'steer'` contradicts documented default `'collect'`

**File:** `packages/channels/base/src/ChannelBase.ts:308` vs `packages/channels/base/src/types.ts:42`

```typescript
// types.ts line 42:
/** Dispatch mode for concurrent messages. Default: 'collect'. */
dispatchMode?: DispatchMode;

// ChannelBase.ts line 308:
const mode: DispatchMode =
  groupCfg?.dispatchMode || this.config.dispatchMode || 'steer';  // defaults to 'steer'!
```

**Impact:** The `ChannelConfig` type documents the default dispatch mode as `'collect'` (buffer messages while a prompt is active), but the actual runtime default is `'steer'` (cancel the running prompt and send a new one). Users who don't set `dispatchMode` expecting `'collect'` behavior will instead get `'steer'`, causing active prompts to be cancelled unexpectedly when concurrent messages arrive.

---

## Bug 12: Crash recovery fails to re-register `disconnected` listener on new bridge

**File:** `packages/cli/src/commands/channel/start.ts:191,217` (and `346,377`)

```typescript
let bridge = new AcpBridge(bridgeOpts);       // line 172/302
bridge.on('disconnected', async () => {        // line 191/346 — listener on ORIGINAL bridge
  // ...crash recovery...
  bridge = new AcpBridge(bridgeOpts);          // line 217/377 — NEW bridge, no listener!
  await bridge.start();
  router.setBridge(bridge);
  // ...
});
```

**Impact:** The `disconnected` event handler is registered on the original bridge instance. After a crash, a new `AcpBridge` is created and assigned to the `bridge` variable, but the `disconnected` listener is never re-registered on the new instance. If the bridge crashes a second time, no recovery code runs — the channel service silently stops responding to all messages.

---

## Bug 13: Hook exit code `null` (signal kill) silently reported as `0`

**File:** `packages/core/src/hooks/hookRunner.ts:434`

```typescript
exitCode: exitCode || EXIT_CODE_SUCCESS,  // EXIT_CODE_SUCCESS = 0
```

**Impact:** When a hook process is killed by an external signal (not timeout or abort), `child.on('close')` fires with `exitCode = null`. The expression `null || 0` evaluates to `0`, so the result reports `exitCode: 0` even though the hook was killed. Combined with the success check on line 430 (`success: exitCode === EXIT_CODE_SUCCESS` which is `null === 0 → false`), the result contradicts itself: `success: false` but `exitCode: 0`. This makes it impossible to distinguish a signal kill from a normal failure.

---

## Bug 14: `expandCommand` doesn't expand `$QWEN_PROJECT_DIR`

**File:** `packages/core/src/hooks/hookRunner.ts:471-473`

```typescript
private expandCommand(command: string, input: HookInput, shellType: ShellType): string {
  const escapedCwd = escapeShellArg(input.cwd, shellType);
  return command
    .replace(/\$GEMINI_PROJECT_DIR/g, () => escapedCwd)
    .replace(/\$CLAUDE_PROJECT_DIR/g, () => escapedCwd);
    // Missing: .replace(/\$QWEN_PROJECT_DIR/g, () => escapedCwd)
}
```

**Impact:** The environment variables set on line 263-265 include `QWEN_PROJECT_DIR`, `GEMINI_PROJECT_DIR`, and `CLAUDE_PROJECT_DIR`. But `expandCommand` only pre-expands the latter two. While the shell process receives all three as environment variables, `expandCommand` is specifically designed to handle pre-expansion for cases where shell variable expansion might not work reliably. Users writing hooks with `$QWEN_PROJECT_DIR` in the command string won't get the same consistent pre-expansion that the other two variables receive.

---

## Bug 15: DingTalk multi-chunk messages all show "(cont.)" title — including the first chunk

**File:** `packages/channels/dingtalk/src/DingtalkAdapter.ts:153`

```typescript
for (const chunk of chunks) {
  const body = {
    msgtype: 'markdown',
    markdown: {
      title: chunks.length > 1 ? `${title} (cont.)` : title,  // same for ALL chunks
      text: chunk,
    },
  };
```

**Impact:** The condition `chunks.length > 1` is invariant across the loop — it's the same for every chunk. When a message is split into multiple chunks, ALL chunks (including the first) get the "(cont.)" suffix in their title. The first chunk should display just `title`; only subsequent chunks should show "(cont.)".

---

## Bug 16: DingTalk @mention stripping is defeated by fallback to original text

**File:** `packages/channels/dingtalk/src/DingtalkAdapter.ts:527,540`

```typescript
if (isMentioned) {
  cleanText = cleanText.replace(/@\S+/, '').trim();  // line 527: strip @mention
}
// ...
const envelope: Envelope = {
  // ...
  text: cleanText || content.text,                     // line 540: fallback to original!
};
```

**Impact:** When a user sends just `"@BotName"` in a group chat with no other text, `cleanText` after stripping the @mention and trimming becomes an empty string. Since empty string is falsy, `cleanText || content.text` falls back to `content.text` — which is the original text WITH the @mention. The agent then receives `"@BotName"` as the prompt, defeating the purpose of stripping @mentions.

---

## Bug 17: DingTalk `reactionContext` map leaks entries for blocked messages

**File:** `packages/channels/dingtalk/src/DingtalkAdapter.ts:549-551`

```typescript
// Always adds to reactionContext before handleInbound checks gates
envelope.messageId = msgId;
if (msgId && conversationId) {
  this.reactionContext.set(msgId, conversationId);   // Entry added unconditionally
}
// ...
await this.handleInbound(envelope);  // May be blocked by sender/group gate
```

Cleanup only happens in `onPromptEnd` (line 253-264), which is only called when a prompt actually runs.

**Impact:** When messages are blocked by the sender gate (e.g. `allowlist` or `pairing` policy) or group gate, `handleInbound` returns early without ever calling `onPromptStart`/`onPromptEnd`. The `reactionContext` entry is never cleaned up, causing a memory leak. For bots with restrictive policies receiving many messages from unapproved users, this map grows unboundedly over the lifetime of the process.

---

## Bug 18: `SessionRouter.hasSession` / `removeSession` prefix-match collides on similar sender IDs

**File:** `packages/channels/base/src/SessionRouter.ts:88-98, 103-125`

```typescript
hasSession(channelName: string, senderId: string, chatId?: string): boolean {
  const key = chatId
    ? this.routingKey(channelName, senderId, chatId)
    : `${channelName}:${senderId}`;
  if (chatId) return this.toSession.has(key);
  for (const k of this.toSession.keys()) {
    if (k.startsWith(`${channelName}:${senderId}`)) return true;  // BUG
  }
  return false;
}
```

Stored keys for the default `'user'` scope have the form `${channelName}:${senderId}:${chatId}` (line 58). The prefix check `k.startsWith('${channelName}:${senderId}')` matches any key whose senderId *starts with* the supplied one, not just exact matches.

**Impact:**
1. **False positive in `hasSession`:** Calling `hasSession('telegram', 'user1')` returns `true` if only `user12` has a session — the two distinct users collide.
2. **Cross-user deletion in `removeSession`:** Line 115 uses the same prefix pattern. Calling `removeSession('telegram', 'user1')` will also delete sessions belonging to `user12`, `user100`, etc.
3. **Fails entirely under `'thread'`/`'single'` scope:** When the channel uses scope `'thread'` (key `${channelName}:${threadId}`) or `'single'` (key `${channelName}:__single__`), the prefix is `${channelName}:${senderId}` which does not appear in the stored keys at all — `hasSession` always returns `false` and `removeSession` never removes anything, even though valid sessions exist.

The correct fix is to append the key separator (`${channelName}:${senderId}:`) and scope the prefix scan to the relevant `SessionScope`.

---

## Bug 19: `Stream.return()` leaves pending `next()` promise unresolved — consumer hangs

**File:** `packages/sdk-typescript/src/utils/Stream.ts:72-78`

```typescript
return(): Promise<IteratorResult<T>> {
  this.isDone = true;
  if (this.returned) {
    this.returned();
  }
  return Promise.resolve({ done: true, value: undefined });
}
```

When an async iterator's consumer breaks out of a `for await (...)` loop (or the iterator is otherwise prematurely closed), the runtime calls `return()` on the iterator. However, `return()` here does not touch `readResolve` / `readReject`.

Consider this sequence:
1. Consumer calls `stream.next()`. Queue is empty, so `readResolve`/`readReject` are assigned and a pending promise is returned.
2. Consumer decides to bail out and calls `stream.return()` (directly, or via `for-await` `break`).
3. `return()` sets `isDone = true` and resolves its *own* promise, but the original `next()` promise stored in `readResolve` is never touched.

**Impact:** The pending `next()` promise never resolves or rejects. Any `await`er of that promise hangs forever, potentially holding references that prevent process shutdown. `done()` correctly handles this case (line 54-59); `error()` handles it too (line 64-69); only `return()` forgets, which is exactly the path taken on iterator cleanup.

---

## Re-verification notes

After re-reading each candidate against the source, three previously listed findings were removed:

- **Former Bug 10 (`publish()` not awaited):** Not a real bug. `MessageBus.publish()` has no internal `await`s — its body is synchronous and already wraps everything in `try/catch` that re-emits errors via the `'error'` event (message-bus.ts:40-68). The missing `await` has no observable effect.
- **Former Bug 18 (`findBlockBoundary` rejects early boundaries):** Not a real bug. The `last < minChars` check is intentional — `minChars` is documented as the minimum block size, and rejecting boundaries whose position is below `minChars` correctly enforces that threshold.
- **Former Bug 20 (`getPositionFromOffsets` start calculation):** This overlapped with Bug 9, which already describes the asymmetry between the start- and end-position calculations in the same function. Merged into Bug 9 to avoid duplication.

Bug 5 (`findBreakPoint` uses `> 0` instead of `>= 0`) remains listed but note that rejecting position 0 may be deliberate (emitting a zero-length prefix would be pointless). It is listed because nothing in the code or comments documents that choice, and the inconsistency with `findBlockBoundary` (which uses `< 0` correctly) suggests it was unintentional.

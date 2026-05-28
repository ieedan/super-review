<script lang="ts">
  import { MessageSquare, Reply, Trash2 } from 'lucide-svelte';
  import { Button } from './ui/button';
  import { Textarea } from './ui/textarea';
  import { actions, app, composerKey } from '$lib/store.svelte';
  import { formatRelative } from '$lib/utils';
  import type { PRReviewComment } from '@shared/types';

  // Metadata stamped onto every DiffLineAnnotation we feed @pierre/diffs.
  // Lets this single component render either an existing comment row or the
  // pending composer for a brand-new comment / reply.
  export type CommentMeta =
    | { kind: 'comment'; comment: PRReviewComment }
    | {
        kind: 'composer';
        filePath: string;
        line: number;
        side: 'LEFT' | 'RIGHT';
        replyTo?: number;
      };

  interface Props {
    meta: CommentMeta;
  }

  let { meta }: Props = $props();

  let composerState = $derived.by(() => {
    if (meta.kind !== 'composer') return null;
    const key = composerKey(meta.filePath, meta.side, meta.line);
    return { key, value: app.pendingComposers[key] ?? null };
  });

  function submit(): void {
    if (composerState) void actions.submitComposer(composerState.key);
  }

  function cancel(): void {
    if (composerState) actions.cancelComposer(composerState.key);
  }

  function reply(comment: PRReviewComment): void {
    actions.openComposer(comment.path, comment.side, comment.line ?? 0, comment.id);
  }

  function remove(comment: PRReviewComment): void {
    void actions.deleteComment(comment.id, comment.path);
  }

  function onKeydown(e: KeyboardEvent): void {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      submit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
    }
  }
</script>

<div class="comment-annotation">
  {#if meta.kind === 'comment'}
    {@const c = meta.comment}
    <article class="comment">
      <img
        class="avatar"
        src={c.authorAvatarUrl}
        alt={c.author}
        width="20"
        height="20"
      />
      <div class="body">
        <header>
          <span class="author">{c.author}</span>
          <span class="time">{formatRelative(c.createdAt)}</span>
        </header>
        <p class="text">{c.body}</p>
        <footer>
          <Button variant="ghost" size="sm" onclick={() => reply(c)}>
            <Reply class="size-3.5" /> Reply
          </Button>
          {#if c.canDelete}
            <Button variant="destructive" size="sm" onclick={() => remove(c)}>
              <Trash2 class="size-3.5" /> Delete
            </Button>
          {/if}
        </footer>
      </div>
    </article>
  {:else if composerState?.value}
    {@const composer = composerState.value}
    <form
      class="composer"
      onsubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div class="composer-header">
        <MessageSquare class="size-3.5 text-muted-foreground" />
        <span>{composer.replyTo ? 'Reply' : 'New comment'}</span>
      </div>
      <Textarea
        class="resize-y"
        placeholder={composer.replyTo ? 'Write a reply…' : 'Leave a comment on this line…'}
        value={composer.draft}
        oninput={(e) =>
          actions.setComposerDraft(composerState!.key, (e.target as HTMLTextAreaElement).value)}
        onkeydown={onKeydown}
        disabled={composer.submitting}
        rows={3}
      />
      <div class="composer-footer">
        <span class="hint">⌘⏎ to submit · esc to cancel</span>
        <div class="actions">
          <Button variant="ghost" size="sm" type="button" onclick={cancel}>Cancel</Button>
          <Button
            variant="default"
            size="sm"
            type="submit"
            disabled={!composer.draft.trim() || composer.submitting}
          >
            {composer.submitting ? 'Posting…' : composer.replyTo ? 'Reply' : 'Comment'}
          </Button>
        </div>
      </div>
    </form>
  {/if}
</div>

<style>
  .comment-annotation {
    padding: 8px 12px;
    background: hsl(var(--muted) / 0.4);
    border-top: 1px solid hsl(var(--border));
    border-bottom: 1px solid hsl(var(--border));
    font-family:
      -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  }
  .comment {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 10px;
    align-items: start;
  }
  .avatar {
    border-radius: 999px;
    margin-top: 2px;
  }
  .body header {
    display: flex;
    gap: 8px;
    align-items: baseline;
    font-size: 12px;
  }
  .author {
    font-weight: 600;
  }
  .time {
    color: hsl(var(--muted-foreground));
    font-size: 11px;
  }
  .text {
    font-size: 13px;
    line-height: 1.45;
    margin: 4px 0 6px;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .body footer {
    display: flex;
    gap: 4px;
  }
  .composer {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .composer-header {
    display: flex;
    gap: 6px;
    align-items: center;
    font-size: 12px;
    color: hsl(var(--muted-foreground));
  }
  .composer-footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .hint {
    font-size: 11px;
    color: hsl(var(--muted-foreground));
  }
  .actions {
    display: flex;
    gap: 4px;
  }
</style>

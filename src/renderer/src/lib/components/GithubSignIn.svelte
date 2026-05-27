<script lang="ts">
  import { Github, LogOut } from 'lucide-svelte';
  import Button from './ui/Button.svelte';
  import { actions, app } from '$lib/store.svelte';

  let open = $state(false);
  let userCode = $state<string | null>(null);
  let verificationUri = $state<string | null>(null);
  let polling = $state(false);
  let errorMsg = $state<string | null>(null);
  let pollHandle: number | null = null;

  function stop(): void {
    if (pollHandle !== null) {
      window.clearInterval(pollHandle);
      pollHandle = null;
    }
    polling = false;
  }

  function close(): void {
    void window.api.github.cancelDeviceFlow();
    stop();
    open = false;
    userCode = null;
    verificationUri = null;
    errorMsg = null;
  }

  async function start(): Promise<void> {
    errorMsg = null;
    open = true;
    try {
      const flow = await window.api.github.startDeviceFlow();
      userCode = flow.userCode;
      verificationUri = flow.verificationUri;
      polling = true;
      pollHandle = window.setInterval(async () => {
        const status = await window.api.github.pollDeviceFlow();
        if (status.state === 'success') {
          stop();
          actions.setGithubAuthed(true);
          open = false;
          userCode = null;
          verificationUri = null;
          void actions.loadPRs();
        } else if (status.state === 'error') {
          stop();
          errorMsg = status.message;
        }
      }, 1500);
    } catch (err) {
      errorMsg = err instanceof Error ? err.message : String(err);
    }
  }
</script>

{#if app.githubAuthed}
  <Button variant="ghost" size="sm" onclick={() => actions.signOutGithub()} title="Sign out">
    <Github class="size-3.5" />
    <LogOut class="size-3" />
  </Button>
{:else}
  <Button variant="ghost" size="sm" onclick={start}>
    <Github class="size-3.5" />
    <span class="hidden sm:inline">Sign in</span>
  </Button>
{/if}

{#if open}
  <button
    aria-label="Close"
    class="fixed inset-0 z-50 cursor-default bg-black/40"
    onclick={close}
  ></button>
  <div
    role="dialog"
    class="fixed left-1/2 top-1/2 z-50 w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-popover p-5 text-popover-foreground shadow-2xl"
  >
    <h2 class="text-base font-semibold">Sign in to GitHub</h2>
    {#if errorMsg}
      <p class="mt-3 rounded border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
        {errorMsg}
      </p>
    {/if}
    {#if userCode && verificationUri}
      <p class="mt-3 text-sm text-muted-foreground">
        Enter this code in your browser:
      </p>
      <div class="my-3 rounded-md border border-border bg-card p-3 text-center font-mono text-2xl tracking-[0.3em]">
        {userCode}
      </div>
      <p class="text-xs text-muted-foreground">
        Verification URL: <a class="underline" href={verificationUri} target="_blank" rel="noreferrer">{verificationUri}</a>
      </p>
      {#if polling}
        <p class="mt-3 text-xs text-muted-foreground">Waiting for confirmation…</p>
      {/if}
    {:else}
      <p class="mt-3 text-sm text-muted-foreground">Starting device flow…</p>
    {/if}
    <div class="mt-4 flex justify-end">
      <Button variant="secondary" size="sm" onclick={close}>Cancel</Button>
    </div>
  </div>
{/if}

<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import UpdateNotice from '@super-review/ui/components/UpdateNotice.svelte';
	import NoticeCard from '@super-review/ui/components/NoticeCard.svelte';
	import ChangesetLogo from '@super-review/ui/components/ChangesetLogo.svelte';
	import Stack from '@super-review/ui/components/stack/Stack.svelte';
	import { Button } from '@super-review/ui/components/ui/button';
	import type { UpdateStatus } from '@super-review/core/types';
	import UpdateNoticeStepperDemo from './UpdateNoticeStepperDemo.svelte';

	// The app-update notice across its whole lifecycle. In the real app it rides
	// the front of the commit-box notices stack (CommitNotices) while
	// electron-updater pulls a release in the background, so these stories are
	// width-constrained to that panel rather than rendered full-bleed.
	const MB = 1024 * 1024;

	const downloading = (percent: number, version = '1.2.0'): UpdateStatus => ({
		state: 'downloading',
		version,
		percent,
		transferred: Math.round((percent / 100) * 84 * MB),
		total: 84 * MB,
		bytesPerSecond: 6 * MB
	});

	const { Story } = defineMeta({
		title: 'Components/Update Notice',
		component: UpdateNotice,
		tags: ['autodocs'],
		args: {
			status: downloading(48),
			onRestart: () => console.log('restart clicked'),
			onDismiss: () => console.log('dismiss clicked')
		},
		parameters: { layout: 'centered' }
	});

	// Roughly the width of the commit panel the card sits in.
	const PANEL = 'w-[320px]';
</script>

<!-- Click through five download stages and into the ready card, so the whole
     sequence (including the handoff at 100%) can be judged as one flow. -->
<Story name="Stepper" args={{ status: downloading(0) }}>
	{#snippet template()}
		<UpdateNoticeStepperDemo />
	{/snippet}
</Story>

<!-- Flip `status` in the controls to move through the lifecycle. -->
<Story name="Playground">
	{#snippet template(args)}
		<div class={PANEL}>
			<UpdateNotice {...args} />
		</div>
	{/snippet}
</Story>

<Story name="Downloading">
	{#snippet template(args)}
		<div class={`${PANEL} flex flex-col gap-3`}>
			{#each [0, 35, 72, 100] as percent (percent)}
				<UpdateNotice {...args} status={downloading(percent)} />
			{/each}
		</div>
	{/snippet}
</Story>

<Story name="Ready to install">
	{#snippet template(args)}
		<div class={PANEL}>
			<UpdateNotice {...args} status={{ state: 'downloaded', version: '1.2.0' }} />
		</div>
	{/snippet}
</Story>

<!-- Dismiss is optional. Without it the card is restart-only, which is how a
     surface with no "later" affordance uses it. -->
<Story name="Ready without dismiss">
	{#snippet template(args)}
		<div class={PANEL}>
			<UpdateNotice
				{...args}
				status={{ state: 'downloaded', version: '1.2.0' }}
				onDismiss={undefined}
			/>
		</div>
	{/snippet}
</Story>

<!-- The handoff, judged as one flow rather than two isolated cards. -->
<Story name="Downloading then ready">
	{#snippet template(args)}
		<div class={`${PANEL} flex flex-col gap-3`}>
			<UpdateNotice {...args} status={downloading(62)} />
			<UpdateNotice {...args} status={{ state: 'downloaded', version: '1.2.0' }} />
		</div>
	{/snippet}
</Story>

<!-- A long version string and a missing one are the two ways the label can shift. -->
<Story name="Edge cases">
	{#snippet template(args)}
		<div class={`${PANEL} flex flex-col gap-3`}>
			<UpdateNotice {...args} status={downloading(48, '2.0.0-nightly.20260724.abcdef1')} />
			<UpdateNotice {...args} status={downloading(3, '')} />
			<UpdateNotice {...args} status={{ state: 'downloaded', version: '' }} />
		</div>
	{/snippet}
</Story>

<!-- The states that render nothing at all, so a regression that starts nagging
     on a silent background check is visible here. -->
<Story name="Silent states">
	{#snippet template(args)}
		<div class={`${PANEL} flex flex-col gap-3`}>
			{#each [{ state: 'idle' }, { state: 'checking' }, { state: 'available', version: '1.2.0' }, { state: 'error', message: 'net::ERR_CONNECTION_REFUSED' }] as status (status.state)}
				<div class="rounded border border-dashed border-border p-2">
					<div class="mb-1 text-[10px] text-muted-foreground">{status.state}</div>
					<UpdateNotice {...args} status={status as UpdateStatus} />
				</div>
			{/each}
		</div>
	{/snippet}
</Story>

<!-- How it actually reads in place: front card of the notices stack, with a
     changeset notice peeking behind it. Hover to fan the stack out. -->
<Story name="In the notices stack">
	{#snippet template(args)}
		<div class={PANEL}>
			<Stack items={[{ id: 'update' }, { id: 'add' }]} gap={8}>
				{#snippet card(n, { dismiss })}
					{#if n.id === 'update'}
						<UpdateNotice {...args} onDismiss={dismiss} />
					{:else}
						<NoticeCard onDismiss={dismiss} dismissTitle="Dismiss for this branch">
							{#snippet logo()}
								<ChangesetLogo class="h-4 w-auto shrink-0" />
							{/snippet}
							Add a changeset?
							{#snippet action()}
								<Button type="button" size="xs" variant="outline" class="h-6 text-[11px]">
									Add
								</Button>
							{/snippet}
						</NoticeCard>
					{/if}
				{/snippet}
			</Stack>
		</div>
	{/snippet}
</Story>

<script lang="ts">
	import type { Member } from '$lib/types.js';

	interface Props {
		member: Member;
		size?: 'sm' | 'md' | 'lg';
	}

	let { member, size = 'md' }: Props = $props();

	const px = { sm: 24, md: 32, lg: 44 };
</script>

<span
	class="avatar {size}"
	style:--avatar-color={member.color}
	style:--avatar-size="{px[size]}px"
	title={member.name}
	aria-label={member.name}
>
	{member.initials}
</span>

<style>
	.avatar {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: var(--avatar-size);
		height: var(--avatar-size);
		border-radius: 999px;
		background: var(--avatar-color);
		color: white;
		font-size: calc(var(--avatar-size) * 0.36);
		font-weight: 600;
		letter-spacing: 0.02em;
		user-select: none;
	}
</style>

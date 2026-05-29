<script lang="ts">
  interface Props {
    class?: string;
  }
  let { class: className = '' }: Props = $props();
</script>

<svg
  class={className}
  viewBox="0 0 24 24"
  xmlns="http://www.w3.org/2000/svg"
  aria-hidden="true"
  fill="currentColor"
>
  <path d="M11.925 24l10.425-6-.157-11.667L11.925 12 1.5 5.842 1.339 17.84l10.586 6.16Z" opacity=".85"/>
  <path d="M22.392 6.000 11.961 12 11.925 0 22.32 6Z" opacity=".55"/>
  <path d="M1.5 5.842 11.961 12 11.925 24 1.339 17.84z" opacity=".7"/>
</svg>

<script lang="ts">
  interface Props {
    class?: string;
  }
  let { class: className = '' }: Props = $props();
</script>

<svg
  class={className}
  viewBox="0 0 64 64"
  fill="none"
  xmlns="http://www.w3.org/2000/svg"
  aria-hidden="true"
>
  <rect
    x="5"
    y="7"
    width="54"
    height="50"
    rx="11"
    fill="#2c2c2e"
    stroke="#d0d4d9"
    stroke-width="2.5"
  />
  <path
    d="M15 23l9 7-9 7"
    stroke="#f5f5f7"
    stroke-width="3.5"
    stroke-linecap="round"
    stroke-linejoin="round"
  />
  <path d="M31 38h13" stroke="#f5f5f7" stroke-width="3.5" stroke-linecap="round" />
</svg>

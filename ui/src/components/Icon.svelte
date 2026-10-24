<script lang="ts" module>
  export type IconName =
    | "eye"
    | "eyeWin"
    | "eyeLost"
    | "mine"
    | "clock"
    | "bulb"
    | "robot"
    | "pause"
    | "play"
    | "trophy"
    | "gear"
    | "info"
    | "flag"
    | "more"
    | "chevron"
    | "check"
    | "restart"
    | "sliders"
    | "palette";
</script>

<script lang="ts">
  let { name, size = 20 }: { name: IconName; size?: number } = $props();
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="1.8"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  {#if name === "eye"}
    <path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Z" />
    <circle cx="12" cy="12" r="3.2" />
    <circle cx="12" cy="12" r="1" fill="currentColor" />
  {:else if name === "eyeWin"}
    <path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Z" />
    <path d="m12 8.6 1 2.2 2.4.3-1.8 1.6.5 2.4-2.1-1.2-2.1 1.2.5-2.4-1.8-1.6 2.4-.3Z" />
  {:else if name === "eyeLost"}
    <path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Z" />
    <path d="m9.5 9.5 5 5m0-5-5 5" />
  {:else if name === "mine"}
    <circle cx="12" cy="12" r="5.5" fill="currentColor" />
    <path d="M12 2.5v3.5m0 12v3.5M2.5 12H6m12 0h3.5" />
  {:else if name === "clock"}
    <circle cx="12" cy="13" r="8" />
    <path d="M12 9v4l2.5 2M9.5 2.5h5" />
  {:else if name === "bulb"}
    <path
      d="M9 18h6m-5 3h4M12 3a6 6 0 0 0-3.6 10.8c.7.6 1.1 1.4 1.1 2.2h5c0-.8.4-1.6 1.1-2.2A6 6 0 0 0 12 3Z"
    />
  {:else if name === "robot"}
    <rect x="4" y="8" width="16" height="11" rx="3" />
    <path d="M12 4v4M8.5 13h.01M15.5 13h.01M9.5 16.5h5" />
    <circle cx="12" cy="3.5" r="1" />
  {:else if name === "pause"}
    <path d="M9 5v14M15 5v14" />
  {:else if name === "play"}
    <path d="M7 4.5v15l12-7.5Z" />
  {:else if name === "trophy"}
    <path d="M8 4h8v5a4 4 0 0 1-8 0V4ZM8 6H5a3 3 0 0 0 3 4m8-4h3a3 3 0 0 1-3 4M12 13v4m-4 3h8" />
  {:else if name === "gear"}
    <circle cx="12" cy="12" r="3" />
    <path
      d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"
    />
  {:else if name === "flag"}
    <path d="M6 21V4m0 0 12 4.5L6 13" />
  {:else if name === "more"}
    <circle cx="5.5" cy="12" r="1.3" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none" />
    <circle cx="18.5" cy="12" r="1.3" fill="currentColor" stroke="none" />
  {:else if name === "chevron"}
    <path d="m6 9 6 6 6-6" />
  {:else if name === "check"}
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  {:else if name === "restart"}
    <path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4.5h4.5" />
  {:else if name === "sliders"}
    <path d="M5 7h9m4 0h1M5 17h3m4 0h7" />
    <circle cx="16" cy="7" r="2" />
    <circle cx="10" cy="17" r="2" />
  {:else if name === "palette"}
    <path
      d="M12 3a9 9 0 0 0 0 18c1 0 1.7-.7 1.7-1.6 0-.5-.2-.8-.5-1.1-.3-.3-.5-.7-.5-1.1 0-.9.8-1.6 1.7-1.6h2A5.6 5.6 0 0 0 21 10c0-3.9-4-7-9-7Z"
    />
    <circle cx="7.5" cy="11.5" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="10.5" cy="7.5" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="15.5" cy="7.5" r="1.2" fill="currentColor" stroke="none" />
  {:else if name === "info"}
    <circle cx="12" cy="12" r="9" />
    <path d="M12 16v-4.5M12 8h.01" />
  {/if}
</svg>

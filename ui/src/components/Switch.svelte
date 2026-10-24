<script lang="ts">
  /** A settings row: label and optional help on the left, an on/off switch on the right. */
  let {
    label,
    help,
    checked = $bindable(false),
  }: { label: string; help?: string; checked?: boolean } = $props();

  const id = $props.id();
</script>

<!-- The whole row toggles the switch; the name is the label alone, the help its description. -->
<label class="setting-row">
  <span class="setting-text">
    <span id="{id}-label">{label}</span>
    {#if help}<small id="{id}-help">{help}</small>{/if}
  </span>
  <input
    type="checkbox"
    role="switch"
    aria-labelledby="{id}-label"
    aria-describedby={help ? `${id}-help` : undefined}
    bind:checked
  />
</label>

<style>
  /* Outranks the global checkbox size. */
  input[role="switch"] {
    flex: none;
    position: relative;
    appearance: none;
    width: var(--switch-width);
    height: var(--switch-height);
    margin: 0;
    box-sizing: border-box;
    border-radius: calc(var(--switch-height) / 2);
    border: 1px solid var(--switch-off-border);
    background: var(--switch-off);
    transition: background 0.15s ease;
  }

  input[role="switch"]::before {
    content: "";
    position: absolute;
    top: 50%;
    left: var(--switch-inset);
    width: var(--switch-knob);
    height: var(--switch-knob);
    border-radius: 50%;
    background: var(--switch-off-knob);
    box-shadow: var(--switch-knob-shadow);
    transform: translateY(-50%);
    transition:
      transform 0.15s var(--ease-out),
      width 0.1s ease,
      height 0.1s ease;
  }

  input[role="switch"]:checked {
    border-color: transparent;
    background: var(--accent);
  }

  input[role="switch"]:checked::before {
    background: var(--switch-on-knob);
    transform: translate(
      calc(var(--switch-width) - var(--switch-knob) - 2 * var(--switch-inset) - 2px),
      -50%
    );
  }

  /* Fluent grows the knob under the pointer. */
  :global(.platform-windows) .setting-row:hover input[role="switch"]::before {
    width: calc(var(--switch-knob) + 2px);
    height: calc(var(--switch-knob) + 2px);
    margin-left: -1px;
  }
</style>

import { Select as SelectPrimitive } from 'bits-ui';

import Select from './hl/select.svelte';

import Value from './select-value.svelte';
import Group from './select-group.svelte';
import Label from './select-label.svelte';
import Item from './select-item.svelte';
import Content from './select-content.svelte';
import Trigger from './select-trigger.svelte';
import Separator from './select-separator.svelte';
import GroupHeading from './select-group-heading.svelte';
import Portal from './select-portal.svelte';

const Root = SelectPrimitive.Root;

export {
	Root,
	Value,
	Group,
	Label,
	Item,
	Content,
	Trigger,
	Separator,
	GroupHeading,
	Portal,
	//
	Root as SelectRoot,
	Value as SelectValue,
	Group as SelectGroup,
	Label as SelectLabel,
	Item as SelectItem,
	Content as SelectContent,
	Trigger as SelectTrigger,
	Separator as SelectSeparator,
	GroupHeading as SelectGroupHeading,
	Portal as SelectPortal,
	// High-level (items → ready-made field). Prefer this for ordinary selects.
	Select
};

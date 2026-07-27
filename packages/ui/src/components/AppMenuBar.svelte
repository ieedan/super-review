<script lang="ts">
	// Windows-only application menu strip that shares a row with the native
	// titleBarOverlay window controls. Renders a shadcn Menubar (HTML) so menus
	// match the rest of the app; macOS keeps the system menu bar and does not
	// mount this component. Accelerators still come from Menu.setApplicationMenu
	// in the main process.
	import { MENU_ACCELERATORS as A, formatAcceleratorLabel } from '@super-review/core/hotkeys';
	import type { WindowChromeAction } from '@super-review/core/types';
	import {
		branchMenuState,
		handleBranchMenuAction,
		handleRepositoryMenuAction,
		repositoryMenuState
	} from '@super-review/ui/app-menu-actions';
	import { actions, licenseBlocked } from '@super-review/ui/store.svelte';
	import * as Menubar from './ui/menubar';
	import iconUrl from '../assets/super-review-icon.png';

	const shortcut = (accelerator: string) => formatAcceleratorLabel(accelerator, false);

	const branch = $derived(branchMenuState());
	const repo = $derived(repositoryMenuState());
	// Custom Branch / Repository / Help flows need the licensed app shell
	// (dialogs + store init). Role menus still work on the activation screen.
	const customMenusEnabled = $derived(!licenseBlocked());

	function chrome(action: WindowChromeAction): void {
		void window.api.windowControls.perform(action);
	}
</script>

<!-- Height must match MENU_BAR_HEIGHT / titleBarOverlay.height in main.
     Styled like TopBar (bg-card/40) so the strip matches the app chrome; the
     overlay color is transparent so native buttons sit on this same surface.
     Pad with titlebar-area env vars (not width:) so a bad/zero width var can't
     collapse the labels to nothing. -->
<div
	class="flex h-[30px] w-full shrink-0 items-center gap-0.5 border-b border-border bg-card/40 backdrop-blur"
	style="-webkit-app-region: drag; padding-left: env(titlebar-area-x, 0px); padding-right: calc(100% - env(titlebar-area-width, 100%) - env(titlebar-area-x, 0px));"
>
	<img src={iconUrl} alt="" class="ml-2 mr-1 size-4 shrink-0 rounded-sm" aria-hidden="true" />
	<div class="flex h-full min-w-0 items-stretch" style="-webkit-app-region: no-drag">
		<Menubar.Root class="h-full">
			<Menubar.Menu>
				<Menubar.Trigger>File</Menubar.Trigger>
				<Menubar.Content>
					<Menubar.Item onSelect={() => chrome('close')}>
						Close Window
						<Menubar.Shortcut>{shortcut('CmdOrCtrl+W')}</Menubar.Shortcut>
					</Menubar.Item>
					<Menubar.Separator />
					<Menubar.Item onSelect={() => chrome('quit')}>
						Quit
						<Menubar.Shortcut>{shortcut('CmdOrCtrl+Q')}</Menubar.Shortcut>
					</Menubar.Item>
				</Menubar.Content>
			</Menubar.Menu>

			<Menubar.Menu>
				<Menubar.Trigger>Edit</Menubar.Trigger>
				<Menubar.Content>
					<Menubar.Item onSelect={() => chrome('undo')}>
						Undo
						<Menubar.Shortcut>{shortcut('CmdOrCtrl+Z')}</Menubar.Shortcut>
					</Menubar.Item>
					<Menubar.Item onSelect={() => chrome('redo')}>
						Redo
						<Menubar.Shortcut>{shortcut('Shift+CmdOrCtrl+Z')}</Menubar.Shortcut>
					</Menubar.Item>
					<Menubar.Separator />
					<Menubar.Item onSelect={() => chrome('cut')}>
						Cut
						<Menubar.Shortcut>{shortcut('CmdOrCtrl+X')}</Menubar.Shortcut>
					</Menubar.Item>
					<Menubar.Item onSelect={() => chrome('copy')}>
						Copy
						<Menubar.Shortcut>{shortcut('CmdOrCtrl+C')}</Menubar.Shortcut>
					</Menubar.Item>
					<Menubar.Item onSelect={() => chrome('paste')}>
						Paste
						<Menubar.Shortcut>{shortcut('CmdOrCtrl+V')}</Menubar.Shortcut>
					</Menubar.Item>
					<Menubar.Item onSelect={() => chrome('selectAll')}>
						Select All
						<Menubar.Shortcut>{shortcut('CmdOrCtrl+A')}</Menubar.Shortcut>
					</Menubar.Item>
				</Menubar.Content>
			</Menubar.Menu>

			<Menubar.Menu>
				<Menubar.Trigger>View</Menubar.Trigger>
				<Menubar.Content>
					<Menubar.Item onSelect={() => chrome('reload')}>
						Reload
						<Menubar.Shortcut>{shortcut('CmdOrCtrl+R')}</Menubar.Shortcut>
					</Menubar.Item>
					<Menubar.Item onSelect={() => chrome('forceReload')}>
						Force Reload
						<Menubar.Shortcut>{shortcut('Shift+CmdOrCtrl+R')}</Menubar.Shortcut>
					</Menubar.Item>
					<Menubar.Item onSelect={() => chrome('toggleDevTools')}>
						Toggle Developer Tools
						<Menubar.Shortcut>{shortcut('Alt+CmdOrCtrl+I')}</Menubar.Shortcut>
					</Menubar.Item>
					<Menubar.Separator />
					<Menubar.Item onSelect={() => chrome('resetZoom')}>
						Actual Size
						<Menubar.Shortcut>{shortcut('CmdOrCtrl+0')}</Menubar.Shortcut>
					</Menubar.Item>
					<Menubar.Item onSelect={() => chrome('zoomIn')}>
						Zoom In
						<Menubar.Shortcut>{shortcut('CmdOrCtrl+=')}</Menubar.Shortcut>
					</Menubar.Item>
					<Menubar.Item onSelect={() => chrome('zoomOut')}>
						Zoom Out
						<Menubar.Shortcut>{shortcut('CmdOrCtrl+-')}</Menubar.Shortcut>
					</Menubar.Item>
					<Menubar.Separator />
					<Menubar.Item onSelect={() => chrome('toggleFullscreen')}>
						Toggle Full Screen
						<Menubar.Shortcut>{shortcut('F11')}</Menubar.Shortcut>
					</Menubar.Item>
				</Menubar.Content>
			</Menubar.Menu>

			<Menubar.Menu>
				<Menubar.Trigger>Repository</Menubar.Trigger>
				<Menubar.Content>
					<Menubar.Item
						disabled={!customMenusEnabled || !repo.hasRepo || !repo.hasRemote}
						onSelect={() => handleRepositoryMenuAction('push')}
					>
						Push
						<Menubar.Shortcut>{shortcut(A.push.accelerator)}</Menubar.Shortcut>
					</Menubar.Item>
					<Menubar.Item
						disabled={!customMenusEnabled || !repo.hasRepo || !repo.hasRemote}
						onSelect={() => handleRepositoryMenuAction('pull')}
					>
						Pull
						<Menubar.Shortcut>{shortcut(A.pull.accelerator)}</Menubar.Shortcut>
					</Menubar.Item>
					<Menubar.Item
						disabled={!customMenusEnabled || !repo.hasRepo || !repo.hasRemote}
						onSelect={() => handleRepositoryMenuAction('fetch')}
					>
						Fetch
						<Menubar.Shortcut>{shortcut(A.fetch.accelerator)}</Menubar.Shortcut>
					</Menubar.Item>
					<Menubar.Separator />
					<Menubar.Item
						disabled={!customMenusEnabled || !repo.hasRepo}
						onSelect={() => handleRepositoryMenuAction('remove')}
					>
						Remove…
						<Menubar.Shortcut>{shortcut(A.removeRepo.accelerator)}</Menubar.Shortcut>
					</Menubar.Item>
					<Menubar.Separator />
					<Menubar.Item
						disabled={!customMenusEnabled || !repo.hasRepo || !repo.hasGithub}
						onSelect={() => handleRepositoryMenuAction('viewOnGithub')}
					>
						View on GitHub
						<Menubar.Shortcut>{shortcut(A.viewOnGithub.accelerator)}</Menubar.Shortcut>
					</Menubar.Item>
					{#if repo.terminalLabel}
						<Menubar.Item
							disabled={!customMenusEnabled || !repo.hasRepo}
							onSelect={() => handleRepositoryMenuAction('openInTerminal')}
						>
							Open in {repo.terminalLabel}
							<Menubar.Shortcut>{shortcut(A.openInTerminal.accelerator)}</Menubar.Shortcut>
						</Menubar.Item>
					{/if}
					<Menubar.Item
						disabled={!customMenusEnabled || !repo.hasRepo}
						onSelect={() => handleRepositoryMenuAction('showInFinder')}
					>
						{repo.revealLabel}
						<Menubar.Shortcut>{shortcut(A.showInFinder.accelerator)}</Menubar.Shortcut>
					</Menubar.Item>
					{#if repo.editorLabel}
						<Menubar.Item
							disabled={!customMenusEnabled || !repo.hasRepo}
							onSelect={() => handleRepositoryMenuAction('openInEditor')}
						>
							Open in {repo.editorLabel}
							<Menubar.Shortcut>{shortcut(A.openInEditor.accelerator)}</Menubar.Shortcut>
						</Menubar.Item>
					{/if}
					<Menubar.Separator />
					<Menubar.Item
						disabled={!customMenusEnabled || !repo.hasRepo || !repo.hasGithub}
						onSelect={() => handleRepositoryMenuAction('createIssue')}
					>
						Create Issue on GitHub
						<Menubar.Shortcut>{shortcut(A.createIssue.accelerator)}</Menubar.Shortcut>
					</Menubar.Item>
					<Menubar.Separator />
					<Menubar.Item
						disabled={!customMenusEnabled || !repo.hasRepo}
						onSelect={() => handleRepositoryMenuAction('cleanupBranches')}
					>
						Clean Up Local Branches…
					</Menubar.Item>
					<Menubar.Item
						disabled={!customMenusEnabled || !repo.hasRepo}
						onSelect={() => handleRepositoryMenuAction('settings')}
					>
						Repository Settings…
					</Menubar.Item>
				</Menubar.Content>
			</Menubar.Menu>

			<Menubar.Menu>
				<Menubar.Trigger>Branch</Menubar.Trigger>
				<Menubar.Content>
					<Menubar.Item
						disabled={!customMenusEnabled || !branch.hasRepo}
						onSelect={() => handleBranchMenuAction('newBranch')}
					>
						New Branch…
						<Menubar.Shortcut>{shortcut(A.newBranch.accelerator)}</Menubar.Shortcut>
					</Menubar.Item>
					<Menubar.Separator />
					<Menubar.Item
						disabled={!customMenusEnabled || !branch.hasRepo || branch.onDefaultBranch}
						onSelect={() => handleBranchMenuAction('updateFromDefault')}
					>
						Update from {branch.defaultBranch}
						<Menubar.Shortcut>{shortcut(A.updateFromDefault.accelerator)}</Menubar.Shortcut>
					</Menubar.Item>
					{#if branch.hasUpstream}
						<Menubar.Item
							disabled={!customMenusEnabled || !branch.hasRepo}
							onSelect={() => handleBranchMenuAction('updateFromUpstream')}
						>
							Update from upstream/{branch.defaultBranch}
						</Menubar.Item>
					{/if}
					<Menubar.Item
						disabled={!customMenusEnabled || !branch.hasRepo || branch.onDefaultBranch}
						onSelect={() => handleBranchMenuAction('deleteBranch')}
					>
						Delete Branch…
						<Menubar.Shortcut>{shortcut(A.deleteBranch.accelerator)}</Menubar.Shortcut>
					</Menubar.Item>
					<Menubar.Separator />
					<Menubar.Item
						disabled={!customMenusEnabled || !branch.hasRepo || !branch.hasChanges}
						onSelect={() => handleBranchMenuAction('discardAll')}
					>
						Discard All Changes…
						<Menubar.Shortcut>{shortcut(A.discardAll.accelerator)}</Menubar.Shortcut>
					</Menubar.Item>
					<Menubar.Separator />
					<Menubar.Item
						disabled={!customMenusEnabled || !branch.hasRepo || branch.onDefaultBranch}
						onSelect={() => handleBranchMenuAction('previewPR')}
					>
						Preview Pull Request
						<Menubar.Shortcut>{shortcut(A.previewPR.accelerator)}</Menubar.Shortcut>
					</Menubar.Item>
					<Menubar.Item
						disabled={!customMenusEnabled || !branch.hasRepo || !branch.hasGithub || branch.onDefaultBranch}
						onSelect={() => handleBranchMenuAction('createPR')}
					>
						{branch.branchPRNumber
							? `View Pull Request #${branch.branchPRNumber}`
							: 'Create Pull Request'}
					</Menubar.Item>
				</Menubar.Content>
			</Menubar.Menu>

			<Menubar.Menu>
				<Menubar.Trigger>Window</Menubar.Trigger>
				<Menubar.Content>
					<Menubar.Item onSelect={() => chrome('minimize')}>
						Minimize
						<Menubar.Shortcut>{shortcut('CmdOrCtrl+M')}</Menubar.Shortcut>
					</Menubar.Item>
					<Menubar.Item onSelect={() => chrome('maximize')}>Maximize</Menubar.Item>
					<Menubar.Separator />
					<Menubar.Item onSelect={() => chrome('close')}>
						Close
						<Menubar.Shortcut>{shortcut('CmdOrCtrl+W')}</Menubar.Shortcut>
					</Menubar.Item>
				</Menubar.Content>
			</Menubar.Menu>

			<Menubar.Menu>
				<Menubar.Trigger>Help</Menubar.Trigger>
				<Menubar.Content>
					<Menubar.Item
						disabled={!customMenusEnabled}
						onSelect={() => actions.openFeedbackDialog()}
					>
						Send Feedback…
						<Menubar.Shortcut>{shortcut(A.sendFeedback.accelerator)}</Menubar.Shortcut>
					</Menubar.Item>
				</Menubar.Content>
			</Menubar.Menu>
		</Menubar.Root>
	</div>
	<!-- Remaining title-bar area stays draggable for moving the window. -->
	<div class="min-w-0 flex-1"></div>
</div>

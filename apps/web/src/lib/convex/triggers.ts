import {
	mutation as rawMutation,
	internalMutation as rawInternalMutation
} from './_generated/server';
import type { DataModel } from './_generated/dataModel';
import { Triggers } from 'convex-helpers/server/triggers';
import { customCtx, customMutation } from 'convex-helpers/server/customFunctions';

const triggers = new Triggers<DataModel>();

// register your triggers here

// make sure you use these functions when mutating data
export const mutation = customMutation(rawMutation, customCtx(triggers.wrapDB));
export const internalMutation = customMutation(rawInternalMutation, customCtx(triggers.wrapDB));

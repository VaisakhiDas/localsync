/**
 * The HTTP API contract. Both sides use these schemas: the server to validate input it
 * must never trust, the browser to validate forms before sending (the server still re-checks).
 */
import { z } from 'zod';
import { TITLE_MAX_LENGTH } from './domain';

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

const email = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email('Enter a valid email address.').max(254, 'Email address is too long.'));

const displayName = z
  .string()
  .transform((v) => v.replace(/\s+/g, ' ').trim())
  .pipe(z.string().min(1, 'Enter your name.').max(80, 'Name must be at most 80 characters.'));

export const registerSchema = z.object({
  email,
  displayName,
  password: z
    .string()
    .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`)
    .max(PASSWORD_MAX_LENGTH, `Password must be at most ${PASSWORD_MAX_LENGTH} characters.`),
});

export const loginSchema = z.object({
  email,
  password: z.string().min(1, 'Enter your password.').max(PASSWORD_MAX_LENGTH),
});

const title = z
  .string()
  .transform((v) => v.replace(/\s+/g, ' ').trim())
  .pipe(z.string().min(1, 'Title cannot be empty.').max(TITLE_MAX_LENGTH));

export const createDocumentSchema = z.object({ title });
export const renameDocumentSchema = z.object({ title });

export const shareRoleSchema = z.enum(['editor', 'viewer']);
export const inviteMemberSchema = z.object({ email, role: shareRoleSchema });
export const changeRoleSchema = z.object({ role: shareRoleSchema });

export const createCommentSchema = z.object({
  body: z.string().trim().min(1, 'Write a comment first.').max(2000, 'Comments are limited to 2000 characters.'),
  /** A copy of the text the comment refers to. It is a quote, NOT a live anchor into the document. */
  quote: z.string().max(300).optional(),
});

export const createVersionSchema = z.object({
  label: z.string().trim().max(120).optional(),
});

// --- response shapes ---------------------------------------------------------

export interface UserDto {
  id: string;
  email: string;
  displayName: string;
}

export interface DocumentDto {
  id: string;
  title: string;
  /** The caller's role. */
  role: 'owner' | 'editor' | 'viewer';
  ownerName: string;
  createdAt: string;
  updatedAt: string;
}

export interface MemberDto {
  userId: string;
  email: string;
  displayName: string;
  role: 'owner' | 'editor' | 'viewer';
}

export interface CommentDto {
  id: string;
  authorId: string;
  authorName: string;
  body: string;
  quote: string | null;
  resolved: boolean;
  createdAt: string;
}

export interface VersionDto {
  id: string;
  label: string | null;
  /** null for automatic checkpoints. */
  createdById: string | null;
  createdByName: string | null;
  createdAt: string;
  sizeBytes: number;
}

export interface ApiErrorBody {
  error: string;
  message: string;
  fields?: Record<string, string>;
}

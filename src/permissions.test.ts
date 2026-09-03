/**
 * The mail permission matrix, blessed rather than assumed.
 *
 * Two keys, and both are admin-only on purpose: the settings hold a provider's credentials, and the
 * delivery log names every address the workspace has written to. Rows list the *effective* grants,
 * cascade included — the kernel expands declared `defaultRoles` upward through guest ⊆ member ⊆
 * admin ⊆ owner, and `permissionMatrixDiff` applies the same expansion.
 *
 * Changing a default is meant to be deliberate: edit `defaultRoles` → this fails naming every row
 * that moved → confirm that is what you meant → update `BLESSED` in the same commit.
 */
import { permissionMatrixDiff } from '@kernhq/testing'
import { describe, expect, it } from 'vitest'
import { mailPermissions } from './contract.js'

/** Every built-in role that holds the permission by default, lowest role first. */
const BLESSED: Record<string, readonly string[]> = {
  'mail.settings.manage': ['admin', 'owner'],
  'mail.deliveries.view': ['admin', 'owner'],
}

/** A provider credential is a way to send as the company. */
const DANGEROUS = ['mail.settings.manage']

describe('mail permissions', () => {
  it('grants each permission to exactly the blessed roles', () => {
    expect(permissionMatrixDiff(mailPermissions, BLESSED)).toEqual([])
  })

  it('namespaces every key under the module id and declares it once', () => {
    const keys = mailPermissions.map((p) => p.key)
    expect(keys.filter((key) => !key.startsWith('mail.'))).toEqual([])
    expect(keys.filter((key, i) => keys.indexOf(key) !== i)).toEqual([])
  })

  it('marks exactly the destructive permissions dangerous', () => {
    const flagged = mailPermissions.filter((p) => p.dangerous).map((p) => p.key)
    expect(flagged.toSorted()).toEqual(DANGEROUS.toSorted())
  })
})

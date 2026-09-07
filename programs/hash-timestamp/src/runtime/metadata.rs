//! Read-only adapter for hashing a Solana account's metadata.

use crate::protocol::hash::metadata::account_metadata_digest;
use anchor_lang::prelude::*;

/// Adapt a borrowed Solana account to the deterministic metadata byte protocol.
pub(crate) fn hash_account_metadata(target: &AccountInfo) -> Result<[u8; 32]> {
    let data = target.try_borrow_data()?;
    Ok(account_metadata_digest(
        target.key,
        target.owner,
        target.lamports(),
        target.executable,
        target.rent_epoch,
        &data,
    ))
}

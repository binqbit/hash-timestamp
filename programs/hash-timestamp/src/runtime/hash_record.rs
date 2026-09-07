use anchor_lang::prelude::*;

use crate::protocol::address::HashAddress;
use crate::protocol::hash::HashSnapshot;
use crate::runtime::account_io::{read, write};
use crate::runtime::pda_account::create_or_claim_pda;
use crate::state::{HashAccount, HashSource};
use crate::ErrorCode;

/// Complete state needed to create one hash record.
pub(crate) struct NewHashRecord {
    source: HashSource,
    hash: [u8; 32],
    created_at: i64,
}

impl NewHashRecord {
    pub(crate) fn now(source: HashSource, hash: [u8; 32]) -> Result<Self> {
        let created_at = Clock::get()?.unix_timestamp;
        require!(created_at != 0, ErrorCode::HashNotFound);
        Ok(Self {
            source,
            hash,
            created_at,
        })
    }

    pub(crate) fn historical(source: HashSource, hash: [u8; 32], created_at: i64) -> Result<Self> {
        require!(created_at != 0, ErrorCode::RestoreTimestampMismatch);
        Ok(Self {
            source,
            hash,
            created_at,
        })
    }
}

pub(crate) struct CreatedHash {
    pub(crate) address: HashAddress,
    pub(crate) rent: u64,
}

/// Derive and persist a record together so an address cannot be paired with
/// unrelated source/hash state by a caller.
pub(crate) fn create<'info>(
    program_id: &Pubkey,
    payer: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
    destination: &AccountInfo<'info>,
    record: NewHashRecord,
) -> Result<CreatedHash> {
    let address = HashAddress::derive(program_id, &record.source, &record.hash);
    require_keys_eq!(destination.key(), address.key, ErrorCode::InvalidHashSeeds);
    require!(
        destination.owner != program_id,
        ErrorCode::HashAlreadyExists
    );

    let space = record.source.space();
    let rent = create_or_claim_pda(
        payer,
        destination,
        space,
        program_id,
        &address.signer_seeds(),
        system_program,
    )?;

    write(
        destination,
        &HashAccount {
            hash: record.hash,
            source: record.source,
            voters: 1,
            created_at: record.created_at,
            bump: address.bump,
        },
    )?;

    Ok(CreatedHash { address, rent })
}

pub(crate) fn validate_live(
    program_id: &Pubkey,
    account_info: &AccountInfo,
    state: &HashAccount,
) -> Result<()> {
    if account_info.owner != program_id {
        return Err(ProgramError::IllegalOwner.into());
    }
    state.validate_initialized()?;
    state.verify_account(program_id, account_info)
}

pub(crate) fn load_from_info(
    program_id: &Pubkey,
    account_info: &AccountInfo,
) -> Result<HashAccount> {
    if account_info.owner != program_id {
        return Err(ProgramError::IllegalOwner.into());
    }
    let state: HashAccount = read(account_info)?;
    validate_live(program_id, account_info, &state)?;
    Ok(state)
}

pub(crate) fn snapshot<'info>(
    program_id: &Pubkey,
    account: &Account<'info, HashAccount>,
) -> Result<HashSnapshot> {
    validate_live(program_id, &account.to_account_info(), account)?;
    Ok(HashSnapshot::from_account(account))
}

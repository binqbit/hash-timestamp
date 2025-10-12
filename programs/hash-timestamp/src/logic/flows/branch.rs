use anchor_lang::prelude::*;

use crate::logic::{create_hash_and_vote, derive_vote, release_vote_from_hash};
use crate::logic::hash::branch::branch_hash_from_snapshot;
use crate::logic::hash::snapshot::ensure_initialized;
use crate::logic::vote::ensure::{
    assert_owned_by_program, assert_system_program_placeholder, ensure_vote_matches,
};
use crate::state::{HashAccount, HashSource};
use crate::ErrorCode;

pub fn branch_and_maybe_migrate_vote<'info>(
    program_id: &Pubkey,
    system_program: &AccountInfo<'info>,
    old_hash: &mut Account<'info, HashAccount>,
    new_hash_account: &AccountInfo<'info>,
    old_vote_info: &AccountInfo<'info>,
    new_vote_info: &AccountInfo<'info>,
    user: &Signer<'info>,
    payload: [u8; 32],
    take_vote: bool,
) -> Result<()> {
    let user_info = user.to_account_info();
    let user_key = user.key();

    let snapshot = ensure_initialized(old_hash, program_id)?;
    let new_hash = branch_hash_from_snapshot(&snapshot, &payload);
    let generation = snapshot
        .generation()
        .checked_add(1)
        .ok_or(ErrorCode::GenerationOverflow)?;
    let source = HashSource::branch(*snapshot.canonical_id(), payload, generation);

    let expected_old_vote = derive_vote(program_id, snapshot.canonical_id(), &user_key);
    let has_expected_old_vote = old_vote_info.key() == expected_old_vote.key;

    let mut old_vote_amount = 0u64;

    if take_vote {
        require!(has_expected_old_vote, ErrorCode::VoteAccountMissing);
        assert_owned_by_program(old_vote_info, program_id, ErrorCode::NoVoteToMigrate)?;
        let vote = ensure_vote_matches(old_vote_info, snapshot.canonical_id(), &user_key)?;
        old_vote_amount = vote.amount;
    } else if has_expected_old_vote && old_vote_info.owner == program_id {
        ensure_vote_matches(old_vote_info, snapshot.canonical_id(), &user_key)?;
    } else if !has_expected_old_vote {
        assert_system_program_placeholder(old_vote_info)?;
    }

    create_hash_and_vote(
        program_id,
        &user_info,
        system_program,
        new_hash_account,
        new_vote_info,
        source,
        new_hash,
        &user_key,
    )?;

    if take_vote {
        release_vote_from_hash(old_hash, old_vote_info, &user_info, old_vote_amount)?;
    }

    Ok(())
}

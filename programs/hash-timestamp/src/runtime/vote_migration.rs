use anchor_lang::prelude::*;

use crate::protocol::address::VoteAddress;
use crate::protocol::hash::snapshot::HashSnapshot;
use crate::runtime::vote_record::{self, ValidatedVote};
use crate::ErrorCode;

pub(crate) fn validate_vote_migration<'info>(
    program_id: &Pubkey,
    snapshot: &HashSnapshot,
    old_vote_info: &AccountInfo<'info>,
    user_key: &Pubkey,
    take_vote: bool,
) -> Result<Option<ValidatedVote<'info>>> {
    let expected_old_vote = VoteAddress::derive(program_id, snapshot.canonical_id(), user_key);
    let has_expected_old_vote = old_vote_info.key() == expected_old_vote.key;

    if take_vote {
        require!(has_expected_old_vote, ErrorCode::VoteAccountMissing);
        require!(
            old_vote_info.owner == program_id,
            ErrorCode::NoVoteToMigrate
        );
        return vote_record::load_and_validate(program_id, old_vote_info, &expected_old_vote)
            .map(Some);
    } else if has_expected_old_vote && old_vote_info.owner == program_id {
        vote_record::load_and_validate(program_id, old_vote_info, &expected_old_vote)?;
    } else if has_expected_old_vote {
        vote_record::validate_vacant(old_vote_info, &expected_old_vote)?;
    } else {
        require_keys_eq!(
            old_vote_info.key(),
            anchor_lang::system_program::ID,
            ErrorCode::VoteAccountMissing
        );
    }

    Ok(None)
}

// Anchor's IDL parser needs the module name to match the file stem.
#[cfg(test)]
#[path = "vote_migration_tests.rs"]
mod vote_migration_tests;

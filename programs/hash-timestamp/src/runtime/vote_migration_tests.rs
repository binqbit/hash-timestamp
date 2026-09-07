use anchor_lang::prelude::*;

use super::validate_vote_migration;
use crate::protocol::address::VoteAddress;
use crate::protocol::hash::branch::branch_source_from_snapshot;
use crate::protocol::hash::HashSnapshot;
use crate::runtime::account_io;
use crate::state::{HashAccount, HashSource, VoteInfo, VOTE_INFO_SPACE};
use crate::ErrorCode;

fn parent(source: HashSource) -> HashSnapshot {
    HashSnapshot::from_account(&HashAccount {
        hash: [17; 32],
        source,
        voters: 1,
        created_at: 42,
        bump: 255,
    })
}

#[derive(Clone, Copy)]
enum ProvidedVote {
    Initialized,
    Vacant,
    Prefunded,
    Sentinel,
    Unrelated,
    ForeignOwner,
    NonemptyData,
    Executable,
    WrongBump,
}

fn migration(kind: ProvidedVote, take_vote: bool) -> Result<bool> {
    let snapshot = parent(HashSource::Hash);
    let voter = Pubkey::new_unique();
    let expected = VoteAddress::derive(&crate::ID, snapshot.canonical_id(), &voter);
    let key = match kind {
        ProvidedVote::Sentinel => anchor_lang::system_program::ID,
        ProvidedVote::Unrelated => Pubkey::new_unique(),
        _ => expected.key,
    };
    let owner = match kind {
        ProvidedVote::Initialized | ProvidedVote::WrongBump => crate::ID,
        ProvidedVote::ForeignOwner => Pubkey::new_unique(),
        _ => anchor_lang::system_program::ID,
    };
    let mut balance = match kind {
        ProvidedVote::Vacant => 0,
        _ => 1_000_000,
    };
    let mut data = match kind {
        ProvidedVote::Initialized | ProvidedVote::WrongBump => vec![0; VOTE_INFO_SPACE],
        ProvidedVote::NonemptyData => vec![0],
        _ => Vec::new(),
    };
    let info = AccountInfo::new(
        &key,
        false,
        true,
        &mut balance,
        &mut data,
        &owner,
        matches!(kind, ProvidedVote::Executable | ProvidedVote::Sentinel),
        0,
    );
    if matches!(kind, ProvidedVote::Initialized | ProvidedVote::WrongBump) {
        account_io::write(
            &info,
            &VoteInfo {
                voter,
                hash_id: *snapshot.canonical_id(),
                amount: 100,
                bump: if matches!(kind, ProvidedVote::WrongBump) {
                    expected.bump ^ 1
                } else {
                    expected.bump
                },
            },
        )?;
    }
    validate_vote_migration(&crate::ID, &snapshot, &info, &voter, take_vote)
        .map(|vote| vote.is_some())
}

#[test]
fn branch_without_migration_accepts_valid_vote_vacancy_or_sentinel() {
    for kind in [
        ProvidedVote::Initialized,
        ProvidedVote::Vacant,
        ProvidedVote::Prefunded,
        ProvidedVote::Sentinel,
    ] {
        assert!(!migration(kind, false).unwrap());
    }
    assert!(migration(ProvidedVote::Initialized, true).unwrap());
}

#[test]
fn branch_migration_rejects_invalid_accounts_at_the_expected_boundary() {
    let cases = [
        (ProvidedVote::Vacant, true, ErrorCode::NoVoteToMigrate),
        (ProvidedVote::Sentinel, true, ErrorCode::VoteAccountMissing),
        (
            ProvidedVote::Unrelated,
            false,
            ErrorCode::VoteAccountMissing,
        ),
        (
            ProvidedVote::ForeignOwner,
            false,
            ErrorCode::InvalidPdaPlaceholder,
        ),
        (
            ProvidedVote::NonemptyData,
            false,
            ErrorCode::InvalidPdaPlaceholder,
        ),
        (
            ProvidedVote::Executable,
            false,
            ErrorCode::InvalidPdaPlaceholder,
        ),
        (ProvidedVote::WrongBump, false, ErrorCode::InvalidHashSeeds),
    ];
    for (kind, take_vote, expected) in cases {
        match migration(kind, take_vote).unwrap_err() {
            anchor_lang::error::Error::AnchorError(error) => {
                assert_eq!(error.error_code_number, u32::from(expected));
            }
            error => panic!("unexpected error: {error}"),
        }
    }
}

#[test]
fn branch_generation_overflow_is_rejected() {
    let snapshot = parent(HashSource::branch([1; 32], [2; 32], u64::MAX));
    match branch_source_from_snapshot(&snapshot, &[3; 32]).unwrap_err() {
        anchor_lang::error::Error::AnchorError(error) => {
            assert_eq!(
                error.error_code_number,
                u32::from(ErrorCode::GenerationOverflow)
            );
        }
        error => panic!("unexpected error: {error}"),
    }
}

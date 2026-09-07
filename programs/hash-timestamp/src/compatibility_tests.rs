//! Golden protocol vectors.
//!
//! These tests intentionally duplicate expected bytes instead of deriving them
//! through the TypeScript SDK. They protect the on-chain ABI and hashing rules
//! while the implementation is reorganized.

use std::str::FromStr;

use anchor_lang::prelude::Pubkey;
use anchor_lang::{AccountSerialize, AnchorSerialize};

use crate::instructions::restore::{
    RestoreAccountSnapshot, RestoreHashFingerprint, RestoreParameters, RestoreProofLink,
};
use crate::protocol::address::{HashAddress, VoteAddress};
use crate::protocol::hash::branch::branch_hash_digest;
use crate::protocol::hash::compose::{
    compose_batch, compose_pack, AccountFingerprint, BatchMember,
};
use crate::protocol::hash::metadata::account_metadata_digest;
use crate::state::{HashAccount, HashSource, VoteInfo, VOTE_INFO_SPACE};
use crate::ErrorCode;

fn bytes32(hex: &str) -> [u8; 32] {
    assert_eq!(hex.len(), 64);
    let mut bytes = [0u8; 32];
    for (index, byte) in bytes.iter_mut().enumerate() {
        *byte = u8::from_str_radix(&hex[index * 2..index * 2 + 2], 16).unwrap();
    }
    bytes
}

fn value_bytes(value: &impl AnchorSerialize) -> Vec<u8> {
    let mut bytes = Vec::new();
    value.serialize(&mut bytes).unwrap();
    bytes
}

fn account_bytes(value: &impl AccountSerialize) -> Vec<u8> {
    let mut bytes = Vec::new();
    value.try_serialize(&mut bytes).unwrap();
    bytes
}

#[test]
fn program_identity_matches_the_public_address() {
    let expected = "HTSx1wheA1TnHSEbKWxmtXKgJNyRfF3QxeK2hHQcJ9pN";
    assert_eq!(crate::ID, Pubkey::from_str(expected).unwrap());
}

#[test]
fn canonical_hash_id_is_stable() {
    let source = HashSource::branch([0x44; 32], [0x55; 32], 42);
    let canonical = HashAccount::derive_id(&source, &[0x11; 32]);

    assert_eq!(
        canonical,
        bytes32("de7cc218a459caaf756d498e46da3749b81dfd9161b6d5ffe351762350385263")
    );
}

#[test]
fn branch_hash_byte_order_is_stable() {
    let parent_id = bytes32("de7cc218a459caaf756d498e46da3749b81dfd9161b6d5ffe351762350385263");
    let digest = branch_hash_digest(&parent_id, 2, -123_456_789, 42, &[0x22; 32]);

    assert_eq!(
        digest,
        bytes32("e4066b9be14508808fa6efec3f911f9eade328921e8ccca37119ddbed274141c")
    );
}

#[test]
fn aggregate_hash_byte_order_is_stable() {
    let first = AccountFingerprint::from_parts([0x11; 32], 2, -123_456_789);
    let second = AccountFingerprint::from_parts([0x22; 32], 4, 987_654_321);
    let expected = bytes32("313dbb66ea86355e1669034d7434dd51f04e45506856d3bac8e1c28d5626054a");

    assert_eq!(compose_pack(&[first, second]).unwrap(), expected);

    let batch = compose_batch(&[
        BatchMember {
            canonical_id: [0x33; 32],
            fingerprint: first,
        },
        BatchMember {
            canonical_id: [0x44; 32],
            fingerprint: second,
        },
    ])
    .unwrap();
    assert_eq!(batch.hash, expected);
}

#[test]
fn account_metadata_hash_byte_order_is_stable() {
    let digest = account_metadata_digest(
        &Pubkey::new_from_array([0x44; 32]),
        &Pubkey::new_from_array([0x55; 32]),
        123_456_789,
        true,
        777,
        &[1, 2, 3, 4],
    );

    assert_eq!(
        digest,
        bytes32("82b78bb2a028133dc9c5eba6d458ef492f5942df843f0081ef0bea087fc2565e")
    );
}

#[test]
fn pda_seed_order_is_stable() {
    let program_id = Pubkey::from_str("4qHXrn8Z72fmDyvBBafJV7QujMJ7jKesa8C6zqcZry5k").unwrap();
    let source = HashSource::branch([0x44; 32], [0x55; 32], 42);
    let derived_hash = HashAddress::derive(&program_id, &source, &[0x11; 32]);

    assert_eq!(
        derived_hash.key,
        Pubkey::from_str("GnKtZVxHnB8D3Mbp47FxcWP8CH9yaC2NDvTh7nxGa9Eb").unwrap()
    );
    assert_eq!(derived_hash.bump, 255);

    let voter = Pubkey::new_from_array([0x33; 32]);
    let derived_vote = VoteAddress::derive(&program_id, derived_hash.canonical_id(), &voter);
    assert_eq!(
        derived_vote.key,
        Pubkey::from_str("BhFUSc6UiBfKQnfngfGZXEoRA2jJ8Sn9TGYwWozsW4uu").unwrap()
    );
    assert_eq!(derived_vote.bump, 252);
}

#[test]
fn account_spaces_and_source_kinds_are_stable() {
    let sources = [
        HashSource::register(),
        HashSource::account(Pubkey::new_from_array([1; 32])),
        HashSource::branch([2; 32], [3; 32], 7),
        HashSource::batch(vec![[4; 32], [5; 32]]),
        HashSource::pack(),
    ];

    assert_eq!(
        sources
            .iter()
            .map(HashSource::discriminator)
            .collect::<Vec<_>>(),
        [0, 1, 2, 3, 4]
    );
    assert_eq!(
        sources.iter().map(HashSource::space).collect::<Vec<_>>(),
        [64, 96, 136, 128, 64]
    );
    assert_eq!(VOTE_INFO_SPACE, 88);
}

#[test]
fn hash_source_wire_layout_is_stable() {
    assert_eq!(value_bytes(&HashSource::Hash), vec![0]);

    let mut expected_account = vec![1];
    expected_account.extend_from_slice(&[0x11; 32]);
    assert_eq!(
        value_bytes(&HashSource::Account {
            account: Pubkey::new_from_array([0x11; 32]),
        }),
        expected_account
    );

    let mut expected_branch = vec![2];
    expected_branch.extend_from_slice(&[0x22; 32]);
    expected_branch.extend_from_slice(&[0x33; 32]);
    expected_branch.extend_from_slice(&[8, 7, 6, 5, 4, 3, 2, 1]);
    assert_eq!(
        value_bytes(&HashSource::Branch {
            previous_hash_id: [0x22; 32],
            payload: [0x33; 32],
            generation: 0x0102_0304_0506_0708,
        }),
        expected_branch
    );

    let mut expected_batch = vec![3, 2, 0, 0, 0];
    expected_batch.extend_from_slice(&[0x44; 32]);
    expected_batch.extend_from_slice(&[0x55; 32]);
    assert_eq!(
        value_bytes(&HashSource::Batch {
            members: vec![[0x44; 32], [0x55; 32]],
        }),
        expected_batch
    );

    assert_eq!(value_bytes(&HashSource::Pack), vec![4]);
}

#[test]
fn hash_account_field_order_and_discriminator_are_stable() {
    let account = HashAccount {
        hash: [0x11; 32],
        source: HashSource::Hash,
        voters: 0x0102_0304_0506_0708,
        created_at: -2,
        bump: 0xfe,
    };

    let mut expected = vec![0x0e, 0x73, 0x65, 0x18, 0x54, 0x02, 0xc4, 0xd4];
    expected.extend_from_slice(&[0x11; 32]);
    expected.push(0);
    expected.extend_from_slice(&[8, 7, 6, 5, 4, 3, 2, 1]);
    expected.extend_from_slice(&[0xfe, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
    expected.push(0xfe);

    let encoded = account_bytes(&account);
    assert_eq!(encoded, expected);
    assert_eq!(encoded.len(), 58);
    assert_eq!(account.space(), 64);
}

#[test]
fn vote_info_field_order_and_discriminator_are_stable() {
    let account = VoteInfo {
        voter: Pubkey::new_from_array([0x11; 32]),
        hash_id: [0x22; 32],
        amount: 0x0102_0304_0506_0708,
        bump: 0xfe,
    };

    let mut expected = vec![0x35, 0x6f, 0xae, 0xa0, 0xa8, 0x10, 0xf8, 0xba];
    expected.extend_from_slice(&[0x11; 32]);
    expected.extend_from_slice(&[0x22; 32]);
    expected.extend_from_slice(&[8, 7, 6, 5, 4, 3, 2, 1]);
    expected.push(0xfe);

    let encoded = account_bytes(&account);
    assert_eq!(encoded, expected);
    assert_eq!(encoded.len(), 81);
    assert_eq!(VOTE_INFO_SPACE, 88);
}

#[test]
fn voter_counter_transitions_preserve_liveness_invariants() {
    let mut account = HashAccount {
        hash: [0x11; 32],
        source: HashSource::Hash,
        voters: 1,
        created_at: 1,
        bump: 255,
    };

    account.validate_initialized().unwrap();
    account.add_voter().unwrap();
    assert_eq!(account.voters, 2);
    assert!(!account.remove_voter().unwrap());
    assert_eq!(account.voters, 1);
    assert!(account.remove_voter().unwrap());
    assert_eq!(account.voters, 0);
    assert!(account.validate_initialized().is_err());
    assert!(account.remove_voter().is_err());
    assert_eq!(
        account.voters, 0,
        "failed underflow must preserve the counter"
    );

    account.voters = u64::MAX;
    assert!(account.add_voter().is_err());
    assert_eq!(
        account.voters,
        u64::MAX,
        "failed overflow must preserve the counter"
    );
}

#[test]
fn restore_value_wire_layout_is_stable() {
    let snapshot = RestoreAccountSnapshot {
        owner: Pubkey::new_from_array([0x11; 32]),
        lamports: 0x0102_0304_0506_0708,
        executable: true,
        rent_epoch: 0x1112_1314_1516_1718,
        data: vec![0xaa, 0xbb],
    };
    let mut expected_snapshot = vec![0x11; 32];
    expected_snapshot.extend_from_slice(&[8, 7, 6, 5, 4, 3, 2, 1]);
    expected_snapshot.push(1);
    expected_snapshot.extend_from_slice(&[0x18, 0x17, 0x16, 0x15, 0x14, 0x13, 0x12, 0x11]);
    expected_snapshot.extend_from_slice(&[2, 0, 0, 0, 0xaa, 0xbb]);
    assert_eq!(value_bytes(&snapshot), expected_snapshot);

    let fingerprint = RestoreHashFingerprint {
        hash: [0x22; 32],
        source_kind: 3,
        created_at: -2,
        generation: 0x0102_0304_0506_0708,
    };
    let mut expected_fingerprint = vec![0x22; 32];
    expected_fingerprint.push(3);
    expected_fingerprint.extend_from_slice(&[0xfe, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
    expected_fingerprint.extend_from_slice(&[8, 7, 6, 5, 4, 3, 2, 1]);
    assert_eq!(value_bytes(&fingerprint), expected_fingerprint);
}

#[test]
fn restore_parameter_variant_order_is_stable() {
    let fingerprint = RestoreHashFingerprint {
        hash: [0x22; 32],
        source_kind: 3,
        created_at: -2,
        generation: 0x0102_0304_0506_0708,
    };
    let fingerprint_bytes = value_bytes(&fingerprint);

    assert_eq!(
        value_bytes(&RestoreParameters::Hash {
            payload: vec![0xaa, 0xbb],
        }),
        vec![0, 2, 0, 0, 0, 0xaa, 0xbb]
    );
    assert_eq!(
        value_bytes(&RestoreParameters::Account { snapshot: None }),
        vec![1, 0]
    );
    let snapshot = RestoreAccountSnapshot {
        owner: Pubkey::new_from_array([0x11; 32]),
        lamports: 0x0102_0304_0506_0708,
        executable: true,
        rent_epoch: 0x1112_1314_1516_1718,
        data: vec![0xaa, 0xbb],
    };
    let mut expected_account = vec![1, 1];
    expected_account.extend_from_slice(&value_bytes(&snapshot));
    assert_eq!(
        value_bytes(&RestoreParameters::Account {
            snapshot: Some(snapshot),
        }),
        expected_account
    );

    let mut expected_branch = vec![2];
    expected_branch.extend_from_slice(&fingerprint_bytes);
    assert_eq!(
        value_bytes(&RestoreParameters::Branch {
            parent: fingerprint.clone(),
        }),
        expected_branch
    );

    let mut expected_batch = vec![3, 1, 0, 0, 0];
    expected_batch.extend_from_slice(&fingerprint_bytes);
    assert_eq!(
        value_bytes(&RestoreParameters::Batch {
            members: vec![fingerprint.clone()],
        }),
        expected_batch
    );

    let mut expected_pack = vec![4, 1, 0, 0, 0];
    expected_pack.extend_from_slice(&fingerprint_bytes);
    assert_eq!(
        value_bytes(&RestoreParameters::Pack {
            members: vec![fingerprint],
        }),
        expected_pack
    );
}

#[test]
fn restore_proof_link_wire_layout_is_stable() {
    let fingerprint = RestoreHashFingerprint {
        hash: [0x22; 32],
        source_kind: 3,
        created_at: -2,
        generation: 0x0102_0304_0506_0708,
    };
    let link = RestoreProofLink {
        hash: [0x44; 32],
        source: HashSource::Branch {
            previous_hash_id: [0x55; 32],
            payload: [0x66; 32],
            generation: 0x0102_0304_0506_0708,
        },
        created_at: -2,
        params: Some(RestoreParameters::Branch {
            parent: fingerprint.clone(),
        }),
    };

    let mut expected = vec![0x44; 32];
    expected.push(2);
    expected.extend_from_slice(&[0x55; 32]);
    expected.extend_from_slice(&[0x66; 32]);
    expected.extend_from_slice(&[8, 7, 6, 5, 4, 3, 2, 1]);
    expected.extend_from_slice(&[0xfe, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
    expected.push(1);
    expected.push(2);
    expected.extend_from_slice(&value_bytes(&fingerprint));

    assert_eq!(value_bytes(&link), expected);
}

#[test]
fn error_numbers_are_stable() {
    assert_eq!(u32::from(ErrorCode::HashNotFound), 6000);
    assert_eq!(u32::from(ErrorCode::VotesNotZero), 6004);
    assert_eq!(u32::from(ErrorCode::DerivedHashMismatch), 6005);
    assert_eq!(u32::from(ErrorCode::RestoreAccountsMisaligned), 6024);
    assert_eq!(u32::from(ErrorCode::PackMemberDuplicate), 6027);
}

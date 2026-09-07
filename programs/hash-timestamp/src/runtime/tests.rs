use anchor_lang::prelude::*;

use super::{account_io, hash_record, lamports, pda_account, vote_record};
use crate::protocol::address::{HashAddress, VoteAddress};
use crate::state::{HashAccount, HashSource, VoteInfo, VOTE_INFO_SPACE};
use crate::ErrorCode;

struct TestAccount {
    key: Pubkey,
    owner: Pubkey,
    lamports: u64,
    data: Vec<u8>,
    executable: bool,
}

impl TestAccount {
    fn new(owner: Pubkey, lamports: u64) -> Self {
        Self {
            key: Pubkey::new_unique(),
            owner,
            lamports,
            data: Vec::new(),
            executable: false,
        }
    }

    fn info(&mut self) -> AccountInfo<'_> {
        AccountInfo::new(
            &self.key,
            false,
            true,
            &mut self.lamports,
            &mut self.data,
            &self.owner,
            self.executable,
            0,
        )
    }
}

fn assert_protocol_error<T>(result: Result<T>, expected: ErrorCode) {
    match result {
        Err(anchor_lang::error::Error::AnchorError(error)) => {
            assert_eq!(error.error_code_number, u32::from(expected));
        }
        _ => panic!("expected protocol error {}", expected.name()),
    }
}

#[test]
fn writer_binding_neither_reads_account_data_nor_requires_sysvars() {
    let mut payer = TestAccount::new(anchor_lang::system_program::ID, 123);
    let mut system = TestAccount::new(Pubkey::new_unique(), 456);
    system.key = anchor_lang::system_program::ID;
    system.executable = true;
    let mut payer_info = payer.info();
    payer_info.is_signer = true;
    let system_info = system.info();
    let signer = Signer::try_from(&payer_info).unwrap();
    let program = Program::<System>::try_from(&system_info).unwrap();
    let payer_data = payer_info.try_borrow_mut_data().unwrap();
    let system_data = system_info.try_borrow_mut_data().unwrap();

    let _writer = super::record_lifecycle::RecordWriter::new(&crate::ID, &signer, &program);

    assert_eq!(payer_info.lamports(), 123);
    assert_eq!(system_info.lamports(), 456);
    assert!(payer_data.is_empty() && system_data.is_empty());
}

#[test]
fn bound_claim_rejects_wrong_recipient_or_hash_before_any_state_change() {
    for wrong_recipient in [true, false] {
        let mut recipient = TestAccount::new(anchor_lang::system_program::ID, 100);
        let voter = if wrong_recipient {
            Pubkey::new_unique()
        } else {
            recipient.key
        };
        let hash = [8; 32];
        let address = HashAddress::derive(&crate::ID, &HashSource::Hash, &hash);
        let vote_address = VoteAddress::derive(&crate::ID, address.canonical_id(), &voter);
        let mut hash_account = TestAccount::new(crate::ID, 200);
        hash_account.key = address.key;
        hash_account.data = vec![0; HashSource::Hash.space()];
        let mut vote_account = TestAccount::new(crate::ID, 300);
        vote_account.key = vote_address.key;
        vote_account.data = vec![0; VOTE_INFO_SPACE];
        let hash_info = hash_account.info();
        let vote_info = vote_account.info();
        let mut recipient_info = recipient.info();
        recipient_info.is_signer = true;
        account_io::write(
            &hash_info,
            &HashAccount {
                hash,
                source: HashSource::Hash,
                voters: 1,
                created_at: 123,
                bump: address.bump,
            },
        )
        .unwrap();
        account_io::write(
            &vote_info,
            &VoteInfo {
                voter,
                hash_id: *address.canonical_id(),
                amount: 200,
                bump: vote_address.bump,
            },
        )
        .unwrap();
        let hash_before = hash_info.try_borrow_data().unwrap().to_vec();
        let vote_before = vote_info.try_borrow_data().unwrap().to_vec();
        let mut typed_hash = Account::<HashAccount>::try_from(&hash_info).unwrap();
        if !wrong_recipient {
            typed_hash.hash = [99; 32];
        }
        let claim = vote_record::load_and_validate(&crate::ID, &vote_info, &vote_address).unwrap();
        let signer = Signer::try_from(&recipient_info).unwrap();

        assert_protocol_error(
            claim.release(&mut typed_hash, &signer),
            if wrong_recipient {
                ErrorCode::NotVoter
            } else {
                ErrorCode::InvalidHashSeeds
            },
        );

        assert_eq!(typed_hash.voters, 1);
        assert_eq!(
            (
                hash_info.lamports(),
                vote_info.lamports(),
                recipient_info.lamports()
            ),
            (200, 300, 100)
        );
        assert_eq!(
            &**hash_info.try_borrow_data().unwrap(),
            hash_before.as_slice()
        );
        assert_eq!(
            &**vote_info.try_borrow_data().unwrap(),
            vote_before.as_slice()
        );
    }
}

#[test]
fn vacant_pda_accepts_zero_underfunded_and_overfunded_balances() {
    for balance in [0, 1, 1_000_000_000] {
        let mut account = TestAccount::new(anchor_lang::system_program::ID, balance);
        pda_account::validate_vacant_system_account(&account.info()).unwrap();
    }
}

#[test]
fn vacant_pda_rejects_other_owners_data_and_executables() {
    let mut foreign = TestAccount::new(Pubkey::new_unique(), 1);
    let mut allocated = TestAccount::new(anchor_lang::system_program::ID, 1);
    allocated.data = vec![0];
    let mut executable = TestAccount::new(anchor_lang::system_program::ID, 1);
    executable.executable = true;

    for account in [&mut foreign, &mut allocated, &mut executable] {
        assert_protocol_error(
            pda_account::validate_vacant_system_account(&account.info()),
            ErrorCode::InvalidPdaPlaceholder,
        );
    }
}

#[test]
fn refund_transfers_exactly_the_claim() {
    let mut source = TestAccount::new(crate::ID, 100);
    let mut recipient = TestAccount::new(anchor_lang::system_program::ID, 20);
    lamports::transfer_from_program_account(&crate::ID, &source.info(), &recipient.info(), 40)
        .unwrap();
    assert_eq!((source.lamports, recipient.lamports), (60, 60));
}

fn assert_runtime_error(result: Result<()>, expected: ProgramError) {
    match result {
        Err(anchor_lang::error::Error::ProgramError(error)) => {
            assert_eq!(error.program_error, expected)
        }
        other => panic!("expected runtime error, got {other:?}"),
    }
}

#[test]
fn failed_refund_arithmetic_preserves_both_balances() {
    for (source_balance, recipient_balance, amount, expected) in [
        (5, 10, 6, ProgramError::InsufficientFunds),
        (5, u64::MAX, 1, ProgramError::ArithmeticOverflow),
    ] {
        let mut source = TestAccount::new(crate::ID, source_balance);
        let mut recipient = TestAccount::new(anchor_lang::system_program::ID, recipient_balance);
        assert_runtime_error(
            lamports::transfer_from_program_account(
                &crate::ID,
                &source.info(),
                &recipient.info(),
                amount,
            ),
            expected,
        );
        assert_eq!(source.lamports, source_balance);
        assert_eq!(recipient.lamports, recipient_balance);
    }
}

#[test]
fn refund_rejects_foreign_owner_and_aliased_recipient() {
    let mut source = TestAccount::new(anchor_lang::system_program::ID, 100);
    let mut recipient = TestAccount::new(anchor_lang::system_program::ID, 20);
    assert_runtime_error(
        lamports::transfer_from_program_account(&crate::ID, &source.info(), &recipient.info(), 40),
        ProgramError::IllegalOwner,
    );
    assert_eq!((source.lamports, recipient.lamports), (100, 20));
    source.owner = crate::ID;
    let info = source.info();
    assert_runtime_error(
        lamports::transfer_from_program_account(&crate::ID, &info, &info.clone(), 40),
        ProgramError::InvalidArgument,
    );
    assert_eq!(info.lamports(), 100);
}

#[test]
fn failed_destination_borrow_preserves_both_refund_balances() {
    let mut source = TestAccount::new(crate::ID, 100);
    let mut recipient = TestAccount::new(anchor_lang::system_program::ID, 20);
    let source_info = source.info();
    let recipient_info = recipient.info();
    let held = recipient_info.try_borrow_lamports().unwrap();
    assert_runtime_error(
        lamports::transfer_from_program_account(&crate::ID, &source_info, &recipient_info, 40),
        ProgramError::AccountBorrowFailed,
    );
    assert_eq!(source_info.lamports(), 100);
    assert_eq!(**held, 20);
}

#[test]
fn live_hash_rejects_uninitialized_state_or_wrong_pda() {
    let address = HashAddress::derive(&crate::ID, &HashSource::Hash, &[9; 32]);
    let mut account = TestAccount::new(crate::ID, 1_000_000);
    account.key = address.key;
    let mut state = HashAccount {
        hash: [9; 32],
        source: HashSource::Hash,
        voters: 1,
        created_at: 10,
        bump: address.bump,
    };
    hash_record::validate_live(&crate::ID, &account.info(), &state).unwrap();
    state.voters = 0;
    assert_protocol_error(
        hash_record::validate_live(&crate::ID, &account.info(), &state),
        ErrorCode::HashNotFound,
    );
    state.voters = 1;
    state.created_at = 0;
    assert_protocol_error(
        hash_record::validate_live(&crate::ID, &account.info(), &state),
        ErrorCode::HashNotFound,
    );
    state.created_at = 10;
    account.key = Pubkey::new_unique();
    assert_protocol_error(
        hash_record::validate_live(&crate::ID, &account.info(), &state),
        ErrorCode::InvalidHashSeeds,
    );
}

#[test]
fn typed_and_raw_votes_share_identity_rules_and_error_order() {
    let voter = Pubkey::new_unique();
    let expected = VoteAddress::derive(&crate::ID, &[42; 32], &voter);
    for (case, error) in [
        ("valid", None),
        ("hash", Some(ErrorCode::InvalidHashSeeds)),
        ("voter", Some(ErrorCode::NotVoter)),
        ("address", Some(ErrorCode::InvalidHashSeeds)),
        ("bump", Some(ErrorCode::InvalidHashSeeds)),
        ("hash_and_voter", Some(ErrorCode::InvalidHashSeeds)),
    ] {
        let mut account = TestAccount::new(crate::ID, 1_000_000);
        account.key = if case == "address" {
            Pubkey::new_unique()
        } else {
            expected.key
        };
        account.data = vec![0; VOTE_INFO_SPACE];
        let state = VoteInfo {
            voter: if matches!(case, "voter" | "hash_and_voter") {
                Pubkey::new_unique()
            } else {
                voter
            },
            hash_id: if matches!(case, "hash" | "hash_and_voter") {
                [43; 32]
            } else {
                [42; 32]
            },
            amount: 100,
            bump: if case == "bump" {
                expected.bump ^ 1
            } else {
                expected.bump
            },
        };
        let info = account.info();
        account_io::write(&info, &state).unwrap();
        let typed = Account::<VoteInfo>::try_from(&info).unwrap();
        let raw_result = vote_record::load_and_validate(&crate::ID, &info, &expected);
        let typed_result =
            vote_record::validate(&crate::ID, &typed, expected.hash_id(), expected.voter());
        if let Some(error) = error {
            // ErrorCode is not Copy: retain the expected number before consuming it.
            let expected_number = u32::from(error);
            for result in [raw_result, typed_result] {
                match result {
                    Err(anchor_lang::error::Error::AnchorError(error)) => {
                        assert_eq!(error.error_code_number, expected_number, "{case}");
                    }
                    _ => panic!("{case}: expected identity validation error"),
                }
            }
        } else {
            assert!(raw_result.is_ok());
            assert!(typed_result.is_ok());
        }
    }
}

#[test]
fn typed_vote_validation_does_not_borrow_serialized_data_again() {
    let voter = Pubkey::new_unique();
    let expected = VoteAddress::derive(&crate::ID, &[42; 32], &voter);
    let mut account = TestAccount::new(crate::ID, 1_000_000);
    account.key = expected.key;
    account.data = vec![0; VOTE_INFO_SPACE];
    let info = account.info();
    account_io::write(
        &info,
        &VoteInfo {
            voter,
            hash_id: [42; 32],
            amount: 100,
            bump: expected.bump,
        },
    )
    .unwrap();
    let typed = Account::<VoteInfo>::try_from(&info).unwrap();

    // A live byte borrow makes a redundant deserialization fail deterministically.
    let _data_guard = info.try_borrow_mut_data().unwrap();
    assert!(
        vote_record::validate(&crate::ID, &typed, expected.hash_id(), expected.voter()).is_ok()
    );
    assert!(vote_record::load_and_validate(&crate::ID, &info, &expected).is_err());
}

#[test]
fn raw_vote_loader_checks_owner_before_decoding_and_rejects_invalid_data() {
    let expected = VoteAddress::derive(&crate::ID, &[42; 32], &Pubkey::new_unique());
    let mut account = TestAccount::new(anchor_lang::system_program::ID, 1);
    account.key = expected.key;
    // No discriminator at all: owner failure must still take precedence.
    assert_protocol_error(
        vote_record::load_and_validate(&crate::ID, &account.info(), &expected),
        ErrorCode::NotVoter,
    );
    account.owner = crate::ID;
    assert!(vote_record::load_and_validate(&crate::ID, &account.info(), &expected).is_err());
    account.data = vec![0; VOTE_INFO_SPACE];
    match vote_record::load_and_validate(&crate::ID, &account.info(), &expected) {
        Err(anchor_lang::error::Error::AnchorError(error)) => assert_eq!(
            error.error_code_number,
            u32::from(anchor_lang::error::ErrorCode::AccountDiscriminatorMismatch),
        ),
        _ => panic!("expected discriminator rejection"),
    }
}

#[test]
fn historical_record_rejects_zero_timestamp() {
    assert_protocol_error(
        hash_record::NewHashRecord::historical(HashSource::Hash, [9; 32], 0),
        ErrorCode::RestoreTimestampMismatch,
    );
}

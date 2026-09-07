use std::collections::{HashMap, HashSet};

use anchor_lang::prelude::*;

use crate::protocol::address::{HashAddress, VoteAddress};
use crate::runtime::hash_record;
use crate::runtime::pda_account::validate_vacant_system_account;
use crate::runtime::vote_record;
use crate::state::HashAccount;
use crate::ErrorCode;

use crate::protocol::restore::RestoreProofLink;

#[derive(Clone)]
pub(super) struct AccountPair<'info> {
    pub(super) hash: AccountInfo<'info>,
    pub(super) vote: AccountInfo<'info>,
}

/// Remaining accounts bound to their proof indices before validation starts.
pub(crate) struct BoundAccountPairs<'info> {
    by_proof_index: HashMap<usize, AccountPair<'info>>,
}

impl<'info> BoundAccountPairs<'info> {
    pub(crate) fn bind(
        program_id: &Pubkey,
        payer: &Pubkey,
        proof: &[RestoreProofLink],
        remaining_accounts: &[AccountInfo<'info>],
    ) -> Result<Self> {
        if proof.is_empty() {
            return Err(ErrorCode::RestoreChainTooShort.into());
        }
        require!(
            remaining_accounts.len() % 2 == 0,
            ErrorCode::RestoreAccountsMisaligned
        );

        let materialization_requested = !remaining_accounts.is_empty();
        let expected_pair_count = proof
            .iter()
            .enumerate()
            .filter(|(index, link)| *index != 0 && link.params.is_some())
            .count();

        let mut proof_index_by_hash_key = HashMap::with_capacity(proof.len());
        for (index, link) in proof.iter().enumerate() {
            let address = HashAddress::derive(program_id, &link.source, &link.hash);
            if proof_index_by_hash_key.insert(address.key, index).is_some() {
                return Err(ErrorCode::RestoreProofDuplicate.into());
            }
        }

        let mut by_proof_index = HashMap::with_capacity(remaining_accounts.len() / 2);
        for chunk in remaining_accounts.chunks_exact(2) {
            let pair = AccountPair {
                hash: chunk[0].clone(),
                vote: chunk[1].clone(),
            };
            let index = *proof_index_by_hash_key
                .get(&pair.hash.key())
                .ok_or(ErrorCode::RestoreProofMismatch)?;
            if index == 0 {
                return Err(ErrorCode::RestoreAccountsMisaligned.into());
            }

            let link = proof.get(index).ok_or(ErrorCode::RestoreProofMismatch)?;
            require!(link.params.is_some(), ErrorCode::RestoreAccountsMisaligned);

            let hash_address = HashAddress::derive(program_id, &link.source, &link.hash);
            let vote_address = VoteAddress::derive(program_id, hash_address.canonical_id(), payer);
            require_keys_eq!(
                pair.vote.key(),
                vote_address.key,
                ErrorCode::InvalidHashSeeds
            );

            if by_proof_index.insert(index, pair).is_some() {
                return Err(ErrorCode::RestoreProofMismatch.into());
            }
        }

        if materialization_requested {
            require!(
                by_proof_index.len() == expected_pair_count,
                ErrorCode::RestoreAccountsMisaligned
            );
        }

        Ok(Self { by_proof_index })
    }

    /// Validate every supplied account without mutating it and return the proof
    /// indices that already contain live hash records.
    pub(crate) fn validate(
        self,
        program_id: &Pubkey,
        payer: &Pubkey,
        proof: &[RestoreProofLink],
    ) -> Result<ValidatedAccountPairs<'info>> {
        let mut existing_indices = HashSet::with_capacity(self.by_proof_index.len() + 1);
        existing_indices.insert(0);

        // Public proof order makes failures deterministic for callers.
        for index in 1..proof.len() {
            let Some(pair) = self.by_proof_index.get(&index) else {
                continue;
            };
            let link = proof.get(index).ok_or(ErrorCode::RestoreProofMismatch)?;
            let hash_address = HashAddress::derive(program_id, &link.source, &link.hash);
            let vote_address = VoteAddress::derive(program_id, hash_address.canonical_id(), payer);

            if pair.hash.owner == program_id {
                let state = hash_record::load_from_info(program_id, &pair.hash)?;
                validate_existing_state(&state, link, false)?;
                validate_existing_vote_or_vacancy(program_id, &pair.vote, &vote_address)?;
                existing_indices.insert(index);
            } else {
                validate_vacant_system_account(&pair.hash)?;
                require!(pair.vote.owner != program_id, ErrorCode::AlreadyVoted);
                vote_record::validate_vacant(&pair.vote, &vote_address)?;
                // Only missing records are materialized. Check both destinations
                // before any creation; existing validation-only pairs may be read-only.
                if !pair.hash.is_writable {
                    return Err(error!(anchor_lang::error::ErrorCode::ConstraintMut)
                        .with_account_name("restore_hash_account"));
                }
                if !pair.vote.is_writable {
                    return Err(error!(anchor_lang::error::ErrorCode::ConstraintMut)
                        .with_account_name("restore_vote_account"));
                }
            }
        }

        Ok(ValidatedAccountPairs {
            accounts: self,
            existing_indices,
        })
    }

    pub(super) fn remove(&mut self, proof_index: usize) -> Option<AccountPair<'info>> {
        self.by_proof_index.remove(&proof_index)
    }

    pub(super) fn requested_indices(&self) -> HashSet<usize> {
        self.by_proof_index.keys().copied().collect()
    }
}

/// Account bindings whose ownership, state, vote and vacancy checks all passed.
pub(crate) struct ValidatedAccountPairs<'info> {
    pub(super) accounts: BoundAccountPairs<'info>,
    pub(super) existing_indices: HashSet<usize>,
}

impl ValidatedAccountPairs<'_> {
    pub(crate) fn existing_indices(&self) -> &HashSet<usize> {
        &self.existing_indices
    }
}

pub(crate) fn validate_anchor(
    program_id: &Pubkey,
    anchor: &AccountInfo,
    tip: &RestoreProofLink,
) -> Result<()> {
    let address = HashAddress::derive(program_id, &tip.source, &tip.hash);
    require_keys_eq!(anchor.key(), address.key, ErrorCode::InvalidHashSeeds);
    if anchor.owner != program_id {
        return Err(ErrorCode::RestoreTipMismatch.into());
    }

    let state = hash_record::load_from_info(program_id, anchor)?;
    validate_existing_state(&state, tip, true)
}

fn validate_existing_state(
    state: &HashAccount,
    link: &RestoreProofLink,
    is_tip: bool,
) -> Result<()> {
    if state.hash != link.hash || state.source != link.source {
        return Err(if is_tip {
            ErrorCode::RestoreTipMismatch
        } else {
            ErrorCode::RestoreProofMismatch
        }
        .into());
    }
    if state.created_at != link.created_at {
        return Err(if is_tip {
            ErrorCode::RestoreTipMismatch
        } else {
            ErrorCode::RestoreTimestampMismatch
        }
        .into());
    }
    Ok(())
}

/// Existing hashes remain validation-only. The supplied vote account is not
/// created, but it must either be the payer's valid vote or a vacant vote PDA.
fn validate_existing_vote_or_vacancy(
    program_id: &Pubkey,
    vote_account: &AccountInfo,
    expected: &VoteAddress,
) -> Result<()> {
    if vote_account.owner == program_id {
        vote_record::load_and_validate(program_id, vote_account, expected)?;
    } else {
        vote_record::validate_vacant(vote_account, expected)?;
    }
    Ok(())
}

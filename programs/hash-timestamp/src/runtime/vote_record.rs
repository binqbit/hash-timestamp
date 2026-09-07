use anchor_lang::prelude::*;
use anchor_lang::system_program::{self, Transfer};

use crate::protocol::address::{HashAddress, VoteAddress};
use crate::runtime::account_io::{read, write};
use crate::runtime::lamports::{close_program_account, transfer_from_program_account};
use crate::runtime::pda_account::{create_or_claim_pda, validate_vacant_system_account};
use crate::state::{VoteInfo, VOTE_INFO_SPACE};
use crate::ErrorCode;

/// Encodes the only two valid economic funding modes for a vote.
#[derive(Clone, Copy, Debug)]
pub(crate) enum VoteFunding {
    /// The hash account's initial rent reserve is the first vote's claim.
    Initial { hash_rent: u64 },
    /// A later voter transfers a new refundable claim into the hash account.
    Additional { deposit: u64 },
}

impl VoteFunding {
    fn recorded_amount(self) -> u64 {
        match self {
            Self::Initial { hash_rent } => hash_rent,
            Self::Additional { deposit } => deposit,
        }
    }

    fn transfer_amount(self) -> u64 {
        match self {
            Self::Initial { .. } => 0,
            Self::Additional { deposit } => deposit,
        }
    }
}

pub(crate) fn create<'info>(
    program_id: &Pubkey,
    payer: &AccountInfo<'info>,
    system_program_info: &AccountInfo<'info>,
    hash_account: &AccountInfo<'info>,
    vote_account: &AccountInfo<'info>,
    hash_address: &HashAddress,
    vote_address: &VoteAddress,
    funding: VoteFunding,
) -> Result<()> {
    require_keys_eq!(
        vote_account.key(),
        vote_address.key,
        ErrorCode::InvalidHashSeeds
    );
    require!(vote_account.owner != program_id, ErrorCode::AlreadyVoted);
    require_keys_eq!(
        hash_account.key(),
        hash_address.key,
        ErrorCode::InvalidHashSeeds
    );
    require!(
        vote_address.hash_id() == hash_address.canonical_id(),
        ErrorCode::InvalidHashSeeds
    );
    if hash_account.owner != program_id {
        return Err(ProgramError::IllegalOwner.into());
    }

    create_or_claim_pda(
        payer,
        vote_account,
        VOTE_INFO_SPACE,
        program_id,
        &vote_address.signer_seeds(),
        system_program_info,
    )?;

    write(
        vote_account,
        &VoteInfo {
            voter: *vote_address.voter(),
            hash_id: *vote_address.hash_id(),
            amount: funding.recorded_amount(),
            bump: vote_address.bump,
        },
    )?;

    let deposit = funding.transfer_amount();
    if deposit > 0 {
        system_program::transfer(
            CpiContext::new(
                system_program_info.clone(),
                Transfer {
                    from: payer.clone(),
                    to: hash_account.clone(),
                },
            ),
            deposit,
        )?;
    }
    Ok(())
}

/// Decode a dynamically supplied vote, then check the shared identity rules.
pub(crate) fn load_and_validate<'info>(
    program_id: &Pubkey,
    account: &AccountInfo<'info>,
    expected: &VoteAddress,
) -> Result<ValidatedVote<'info>> {
    require_keys_eq!(*account.owner, *program_id, ErrorCode::NotVoter);

    let vote: VoteInfo = read(account)?;
    validate_identity(program_id, account.clone(), &vote, expected)
}

/// Check an Anchor-decoded vote without reading or deserializing its bytes again.
pub(crate) fn validate<'info>(
    program_id: &Pubkey,
    account: &Account<'info, VoteInfo>,
    hash_id: &[u8; 32],
    voter: &Pubkey,
) -> Result<ValidatedVote<'info>> {
    let expected = VoteAddress::derive(program_id, hash_id, voter);
    require_keys_eq!(
        *account.to_account_info().owner,
        *program_id,
        ErrorCode::NotVoter
    );
    validate_identity(program_id, account.to_account_info(), account, &expected)
}

fn validate_identity<'info>(
    program_id: &Pubkey,
    account: AccountInfo<'info>,
    vote: &VoteInfo,
    expected: &VoteAddress,
) -> Result<ValidatedVote<'info>> {
    require!(
        vote.hash_id == *expected.hash_id(),
        ErrorCode::InvalidHashSeeds
    );
    require_keys_eq!(vote.voter, *expected.voter(), ErrorCode::NotVoter);
    require_keys_eq!(account.key(), expected.key, ErrorCode::InvalidHashSeeds);
    require_eq!(vote.bump, expected.bump, ErrorCode::InvalidHashSeeds);
    Ok(ValidatedVote {
        program_id: *program_id,
        account,
        state: vote.clone(),
    })
}

/// A vote whose owner, discriminator, PDA, voter, hash identity and bump have
/// all been checked. Only this module can construct a refundable vote claim.
pub(crate) struct ValidatedVote<'info> {
    program_id: Pubkey,
    account: AccountInfo<'info>,
    state: VoteInfo,
}

pub(crate) fn validate_vacant(account: &AccountInfo, expected: &VoteAddress) -> Result<()> {
    require_keys_eq!(account.key(), expected.key, ErrorCode::VoteAccountMissing);
    validate_vacant_system_account(account)
}

fn validate_refund_reserve(
    balance: u64,
    refundable_amount: u64,
    required_reserve: u64,
) -> core::result::Result<(), ProgramError> {
    let balance_after_refund = balance
        .checked_sub(refundable_amount)
        .ok_or(ProgramError::InsufficientFunds)?;
    if balance_after_refund < required_reserve {
        return Err(ProgramError::AccountNotRentExempt);
    }
    Ok(())
}

impl<'info> ValidatedVote<'info> {
    /// Consume this bound claim; callers cannot substitute another vote account.
    pub(crate) fn release(
        self,
        hash_account: &mut Account<'info, crate::state::HashAccount>,
        recipient: &Signer<'info>,
    ) -> Result<bool> {
        let program_id = &self.program_id;
        let recipient = recipient.to_account_info();
        require_keys_eq!(recipient.key(), self.state.voter, ErrorCode::NotVoter);
        require!(
            hash_account.canonical_id() == self.state.hash_id,
            ErrorCode::InvalidHashSeeds
        );
        let refundable_amount = self.state.amount;
        let hash_info = hash_account.to_account_info();
        if hash_account.voters > 1 && refundable_amount > 0 {
            let reserve = Rent::get()?.minimum_balance(hash_info.data_len());
            validate_refund_reserve(hash_info.lamports(), refundable_amount, reserve)?;
        }

        let is_last_vote = hash_account.remove_voter()?;
        close_program_account(program_id, &self.account, &recipient)?;

        if is_last_vote {
            close_program_account(program_id, &hash_info, &recipient)?;
        } else {
            transfer_from_program_account(program_id, &hash_info, &recipient, refundable_amount)?;
        }

        Ok(is_last_vote)
    }
}

#[cfg(test)]
mod tests {
    use super::validate_refund_reserve;
    use anchor_lang::prelude::ProgramError;

    #[test]
    fn refund_may_retain_exactly_the_required_reserve() {
        assert_eq!(validate_refund_reserve(150, 50, 100), Ok(()));
    }

    #[test]
    fn refund_may_leave_funds_above_the_required_reserve() {
        assert_eq!(validate_refund_reserve(151, 50, 100), Ok(()));
    }

    #[test]
    fn refund_larger_than_the_balance_reports_insufficient_funds_first() {
        assert_eq!(
            validate_refund_reserve(49, 50, 100),
            Err(ProgramError::InsufficientFunds)
        );
    }

    #[test]
    fn refund_may_not_leave_less_than_the_required_reserve() {
        assert_eq!(
            validate_refund_reserve(149, 50, 100),
            Err(ProgramError::AccountNotRentExempt)
        );
    }
}

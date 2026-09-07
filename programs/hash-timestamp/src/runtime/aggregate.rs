//! Shared ordered-member validation and composition for Batch and Pack.

use std::collections::HashSet;

use anchor_lang::prelude::*;

use crate::protocol::hash::compose::{
    compose_batch, compose_pack, AccountFingerprint, BatchMember,
};
use crate::runtime::hash_record;
use crate::state::HashSource;
use crate::ErrorCode;

#[derive(Clone, Copy, Debug)]
pub(crate) enum AggregateKind {
    Batch,
    Pack,
}

impl AggregateKind {
    fn label(self) -> &'static str {
        match self {
            Self::Batch => "batch",
            Self::Pack => "pack",
        }
    }

    fn empty_error(self) -> ErrorCode {
        match self {
            Self::Batch => ErrorCode::BatchMembersEmpty,
            Self::Pack => ErrorCode::PackMembersEmpty,
        }
    }

    fn owner_error(self) -> ErrorCode {
        match self {
            Self::Batch => ErrorCode::BatchMemberWrongProgram,
            Self::Pack => ErrorCode::PackMemberWrongProgram,
        }
    }

    fn duplicate_error(self) -> ErrorCode {
        match self {
            Self::Batch => ErrorCode::BatchMemberDuplicate,
            Self::Pack => ErrorCode::PackMemberDuplicate,
        }
    }
}

#[derive(Clone, Copy, Debug)]
struct VerifiedMember {
    canonical_id: [u8; 32],
    fingerprint: AccountFingerprint,
}

pub(crate) struct VerifiedMembers {
    kind: AggregateKind,
    members: Vec<VerifiedMember>,
}

impl VerifiedMembers {
    pub(crate) fn load(
        program_id: &Pubkey,
        accounts: &[AccountInfo],
        kind: AggregateKind,
    ) -> Result<Self> {
        if accounts.is_empty() {
            return Err(kind.empty_error().into());
        }

        let mut members = Vec::with_capacity(accounts.len());
        let mut unique_ids = HashSet::with_capacity(accounts.len());

        for (index, account_info) in accounts.iter().enumerate() {
            if account_info.owner != program_id {
                return Err(kind.owner_error().into());
            }

            let state = hash_record::load_from_info(program_id, account_info)?;
            let canonical_id = state.canonical_id();
            if !unique_ids.insert(canonical_id) {
                return Err(kind.duplicate_error().into());
            }

            crate::debug_log!(
                "checkpoint=aggregate.member kind={} index={} account={} created_at={} voters={}",
                kind.label(),
                index,
                account_info.key(),
                state.created_at,
                state.voters
            );
            members.push(VerifiedMember {
                canonical_id,
                fingerprint: AccountFingerprint::from_account(&state),
            });
        }

        Ok(Self { kind, members })
    }

    pub(crate) fn compose(self) -> Result<(HashSource, [u8; 32])> {
        match self.kind {
            AggregateKind::Batch => {
                let members = self
                    .members
                    .into_iter()
                    .map(|member| BatchMember {
                        canonical_id: member.canonical_id,
                        fingerprint: member.fingerprint,
                    })
                    .collect::<Vec<_>>();
                let composition = compose_batch(&members)?;
                Ok((composition.source, composition.hash))
            }
            AggregateKind::Pack => {
                let fingerprints = self
                    .members
                    .into_iter()
                    .map(|member| member.fingerprint)
                    .collect::<Vec<_>>();
                Ok((HashSource::pack(), compose_pack(&fingerprints)?))
            }
        }
    }
}

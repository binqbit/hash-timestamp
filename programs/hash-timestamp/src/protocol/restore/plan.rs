use crate::ErrorCode;
use anchor_lang::prelude::*;
use std::collections::HashSet;

use super::{graph::ProofGraph, RestoreProofLink};

/// Commitment-valid proof under the supplied existing-record facts.
/// The handler authenticates the on-chain anchor separately before verification.
pub(crate) struct ValidatedProof<'proof> {
    pub(super) graph: ProofGraph<'proof>,
    pub(super) existing_indices: HashSet<usize>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum MaterializationDecision {
    None,
    Create,
}

fn materialization_decision(
    is_tip: bool,
    has_account_pair: bool,
    already_exists: bool,
) -> Result<MaterializationDecision> {
    if is_tip {
        require!(already_exists, ErrorCode::RestoreTipMismatch);
        return Ok(MaterializationDecision::None);
    }
    if has_account_pair && !already_exists {
        Ok(MaterializationDecision::Create)
    } else {
        Ok(MaterializationDecision::None)
    }
}

/// A dependency-first historical record to materialize; contains no account handles.
pub(crate) struct PlannedRecord<'proof> {
    pub(crate) proof_index: usize,
    pub(crate) link: &'proof RestoreProofLink,
}

pub(crate) struct RestorePlan<'proof> {
    creations: Vec<PlannedRecord<'proof>>,
}

impl<'proof> RestorePlan<'proof> {
    pub(crate) fn build(
        validated: ValidatedProof<'proof>,
        requested_indices: &HashSet<usize>,
    ) -> Result<Self> {
        let ValidatedProof {
            graph,
            existing_indices,
        } = validated;
        let mut creations = Vec::with_capacity(requested_indices.len());

        for index in graph.ordered_indices {
            let decision = materialization_decision(
                index == 0,
                requested_indices.contains(&index),
                existing_indices.contains(&index),
            )?;
            if decision == MaterializationDecision::None {
                continue;
            }

            let link = graph
                .entries
                .get(index)
                .ok_or(ErrorCode::RestoreProofMismatch)?
                .link;
            creations.push(PlannedRecord {
                proof_index: index,
                link,
            });
        }
        Ok(Self { creations })
    }

    pub(crate) fn into_creations(self) -> Vec<PlannedRecord<'proof>> {
        self.creations
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::hash::branch::branch_hash_digest;
    use crate::protocol::restore::{RestoreHashFingerprint, RestoreParameters};
    use crate::state::HashSource;

    fn proof() -> [RestoreProofLink; 2] {
        let parent = RestoreProofLink {
            hash: [7; 32],
            source: HashSource::Hash,
            created_at: 123,
            params: Some(RestoreParameters::Hash {
                payload: vec![7; 32],
            }),
        };
        let parent_id = parent.canonical_id();
        let payload = [9; 32];
        let tip = RestoreProofLink {
            hash: branch_hash_digest(&parent_id, 0, 123, 0, &payload),
            source: HashSource::Branch {
                previous_hash_id: parent_id,
                payload,
                generation: 1,
            },
            created_at: 456,
            params: Some(RestoreParameters::Branch {
                parent: RestoreHashFingerprint {
                    hash: parent.hash,
                    source_kind: 0,
                    created_at: 123,
                    generation: 0,
                },
            }),
        };
        [tip, parent]
    }

    #[test]
    fn pure_plan_retains_exact_historical_record_and_dependency_index() {
        let proof = proof();
        let validated = ProofGraph::parse(&proof)
            .unwrap()
            .validate(&HashSet::from([0]))
            .unwrap();
        let creations = RestorePlan::build(validated, &HashSet::from([1]))
            .unwrap()
            .into_creations();
        assert_eq!(creations.len(), 1);
        assert_eq!(creations[0].proof_index, 1);
        assert!(core::ptr::eq(creations[0].link, &proof[1]));
        assert_eq!(creations[0].link.created_at, 123);
    }

    #[test]
    fn pure_plan_excludes_existing_records_and_unrequested_history() {
        let proof = proof();
        for (existing, requested) in [
            (HashSet::from([0, 1]), HashSet::from([1])),
            (HashSet::from([0]), HashSet::new()),
        ] {
            let validated = ProofGraph::parse(&proof)
                .unwrap()
                .validate(&existing)
                .unwrap();
            assert!(RestorePlan::build(validated, &requested)
                .unwrap()
                .into_creations()
                .is_empty());
        }
    }

    #[test]
    fn plans_only_missing_non_tip_records_with_account_pairs() {
        assert_eq!(
            materialization_decision(false, true, false).unwrap(),
            MaterializationDecision::Create
        );
        assert_eq!(
            materialization_decision(false, true, true).unwrap(),
            MaterializationDecision::None
        );
        assert_eq!(
            materialization_decision(false, false, false).unwrap(),
            MaterializationDecision::None
        );
    }

    #[test]
    fn never_materializes_the_tip() {
        assert_eq!(
            materialization_decision(true, true, true).unwrap(),
            MaterializationDecision::None
        );
        assert!(materialization_decision(true, true, false).is_err());
    }
}

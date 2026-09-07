use anchor_lang::prelude::*;

use crate::state::HashSource;
use crate::ErrorCode;
use std::collections::{HashMap, HashSet};

use super::types::{RestoreParameters, RestoreProofLink};

pub(super) struct ProofEntry<'a> {
    pub(super) canonical_id: [u8; 32],
    pub(super) link: &'a RestoreProofLink,
    pub(super) index: usize,
}

#[derive(Clone, Copy)]
struct ProofWalkFrame {
    index: usize,
    dependency_offset: usize,
}

pub(crate) struct ProofGraph<'a> {
    pub(super) entries: Vec<ProofEntry<'a>>,
    pub(super) ordered_indices: Vec<usize>,
}

fn proof_dependencies(link: &RestoreProofLink) -> Result<Vec<[u8; 32]>> {
    match (&link.source, link.params.as_ref()) {
        (HashSource::Hash, None) => Ok(Vec::new()),
        (HashSource::Hash, Some(RestoreParameters::Hash { .. })) => Ok(Vec::new()),
        (HashSource::Hash, Some(_)) => Err(ErrorCode::RestoreProofMismatch.into()),

        (HashSource::Account { .. }, None) => Err(ErrorCode::RestoreProofMismatch.into()),
        (HashSource::Account { .. }, Some(RestoreParameters::Account { .. })) => Ok(Vec::new()),
        (HashSource::Account { .. }, Some(_)) => Err(ErrorCode::RestoreProofMismatch.into()),

        (HashSource::Branch { .. }, None) => Err(ErrorCode::RestoreProofMismatch.into()),
        (
            HashSource::Branch {
                previous_hash_id, ..
            },
            Some(RestoreParameters::Branch { .. }),
        ) => Ok(vec![*previous_hash_id]),
        (HashSource::Branch { .. }, Some(_)) => Err(ErrorCode::RestoreProofMismatch.into()),

        (HashSource::Batch { .. }, None) => Err(ErrorCode::RestoreProofMismatch.into()),
        (
            HashSource::Batch { members },
            Some(RestoreParameters::Batch {
                members: fingerprints,
            }),
        ) => {
            if members.is_empty() || fingerprints.is_empty() {
                return Err(ErrorCode::BatchMembersEmpty.into());
            }
            ensure_unique_batch_members(members)?;
            Ok(members.clone())
        }
        (HashSource::Batch { .. }, Some(_)) => Err(ErrorCode::RestoreProofMismatch.into()),

        (HashSource::Pack, None) => Err(ErrorCode::RestoreProofMismatch.into()),
        (HashSource::Pack, Some(RestoreParameters::Pack { members })) => {
            if members.is_empty() {
                return Err(ErrorCode::RestorePackMembersMissing.into());
            }
            Ok(members
                .iter()
                .map(|fingerprint| fingerprint.canonical_id())
                .collect())
        }
        (HashSource::Pack, Some(_)) => Err(ErrorCode::RestoreProofMismatch.into()),
    }
}

fn ensure_unique_batch_members(members: &[[u8; 32]]) -> Result<()> {
    let mut unique = HashSet::with_capacity(members.len());
    for member in members {
        require!(unique.insert(*member), ErrorCode::BatchMemberDuplicate);
    }
    Ok(())
}

pub(super) fn build_proof_graph<'a>(proof_chain: &'a [RestoreProofLink]) -> Result<ProofGraph<'a>> {
    if proof_chain.is_empty() {
        return Err(ErrorCode::RestoreChainTooShort.into());
    }

    let mut proof_entries: Vec<ProofEntry<'a>> = Vec::with_capacity(proof_chain.len());
    let mut canonical_to_index: HashMap<[u8; 32], usize> =
        HashMap::with_capacity(proof_chain.len());

    for (index, link) in proof_chain.iter().enumerate() {
        let canonical = link.canonical_id();
        if canonical_to_index.insert(canonical, index).is_some() {
            return Err(ErrorCode::RestoreProofDuplicate.into());
        }
        proof_entries.push(ProofEntry {
            canonical_id: canonical,
            link,
            index,
        });
    }

    let mut dependencies_by_index: Vec<Vec<[u8; 32]>> = Vec::with_capacity(proof_chain.len());
    for entry in proof_entries.iter() {
        dependencies_by_index.push(proof_dependencies(entry.link)?);
    }

    let mut visited: HashSet<[u8; 32]> = HashSet::with_capacity(proof_chain.len());
    let mut visiting: HashSet<[u8; 32]> = HashSet::with_capacity(proof_chain.len());
    let mut ordered_indices: Vec<usize> = Vec::with_capacity(proof_chain.len());
    let mut stack: Vec<ProofWalkFrame> = Vec::with_capacity(proof_chain.len());

    stack.push(ProofWalkFrame {
        index: 0,
        dependency_offset: 0,
    });
    visiting.insert(proof_entries[0].canonical_id);

    while let Some(frame) = stack.last_mut() {
        let deps = dependencies_by_index
            .get(frame.index)
            .ok_or(ErrorCode::RestoreProofMismatch)?;

        if frame.dependency_offset < deps.len() {
            let dependency_canonical = deps[frame.dependency_offset];
            frame.dependency_offset += 1;

            if visited.contains(&dependency_canonical) {
                continue;
            }

            let dependency_index = *canonical_to_index
                .get(&dependency_canonical)
                .ok_or(ErrorCode::RestoreDependencyMissing)?;

            if !visiting.insert(dependency_canonical) {
                return Err(ErrorCode::RestoreProofMismatch.into());
            }

            stack.push(ProofWalkFrame {
                index: dependency_index,
                dependency_offset: 0,
            });
            continue;
        }

        let completed = stack.pop().ok_or(ErrorCode::RestoreProofMismatch)?;
        let completed_canonical = proof_entries[completed.index].canonical_id;
        visiting.remove(&completed_canonical);
        visited.insert(completed_canonical);
        ordered_indices.push(completed.index);
    }

    if visited.len() != proof_entries.len() || ordered_indices.len() != proof_entries.len() {
        return Err(ErrorCode::RestoreProofMismatch.into());
    }

    Ok(ProofGraph {
        entries: proof_entries,
        ordered_indices,
    })
}

#[cfg(test)]
mod tests {
    use super::super::types::RestoreHashFingerprint;
    use super::*;

    fn bytes(value: u8) -> [u8; 32] {
        [value; 32]
    }

    fn hash_link(value: u8) -> RestoreProofLink {
        RestoreProofLink {
            hash: bytes(value),
            source: HashSource::Hash,
            created_at: 1,
            params: None,
        }
    }

    fn branch_link(value: u8, parent_id: [u8; 32]) -> RestoreProofLink {
        RestoreProofLink {
            hash: bytes(value),
            source: HashSource::Branch {
                previous_hash_id: parent_id,
                payload: bytes(value.wrapping_add(1)),
                generation: 1,
            },
            created_at: 2,
            params: Some(RestoreParameters::Branch {
                parent: RestoreHashFingerprint {
                    hash: bytes(0),
                    source_kind: 0,
                    created_at: 1,
                    generation: 0,
                },
            }),
        }
    }

    #[test]
    fn orders_dependencies_before_the_tip() {
        let parent = hash_link(1);
        let tip = branch_link(2, parent.canonical_id());
        let proof = [tip, parent];

        let graph = build_proof_graph(&proof).expect("valid proof graph");

        assert_eq!(graph.ordered_indices, vec![1, 0]);
    }

    #[test]
    fn rejects_disconnected_entries() {
        let proof = [hash_link(1), hash_link(2)];

        assert!(build_proof_graph(&proof).is_err());
    }

    #[test]
    fn rejects_missing_dependencies() {
        let proof = [branch_link(1, bytes(9))];

        assert!(build_proof_graph(&proof).is_err());
    }

    #[test]
    fn rejects_duplicate_canonical_entries() {
        let proof = [hash_link(1), hash_link(1)];

        assert!(build_proof_graph(&proof).is_err());
    }

    #[test]
    fn rejects_cycles() {
        let first_id = branch_link(1, bytes(0)).canonical_id();
        let second_id = branch_link(2, bytes(0)).canonical_id();
        let proof = [branch_link(1, second_id), branch_link(2, first_id)];

        assert!(build_proof_graph(&proof).is_err());
    }

    #[test]
    fn rejects_duplicate_batch_members() {
        let member = hash_link(1);
        let member_id = member.canonical_id();
        let fingerprint = RestoreHashFingerprint {
            hash: member.hash,
            source_kind: member.source.discriminator(),
            created_at: member.created_at,
            generation: member.source.generation(),
        };
        let batch = RestoreProofLink {
            hash: bytes(2),
            source: HashSource::Batch {
                members: vec![member_id, member_id],
            },
            created_at: 2,
            params: Some(RestoreParameters::Batch {
                members: vec![fingerprint.clone(), fingerprint],
            }),
        };
        let proof = [batch, member];

        assert!(build_proof_graph(&proof).is_err());
    }
}

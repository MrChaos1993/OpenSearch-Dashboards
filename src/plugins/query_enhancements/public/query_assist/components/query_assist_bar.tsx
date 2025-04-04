/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { EuiFlexGroup, EuiFlexItem, EuiForm, EuiFormRow } from '@elastic/eui';
import React, { SyntheticEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Dataset } from '../../../../data/common';
import {
  IDataPluginServices,
  PersistedLog,
  QueryEditorExtensionDependencies,
} from '../../../../data/public';
import { useOpenSearchDashboards } from '../../../../opensearch_dashboards_react/public';
import { QueryAssistParameters } from '../../../common/query_assist';
import { getStorage } from '../../services';
import { useGenerateQuery } from '../hooks';
import { getPersistedLog, AgentError, ProhibitedQueryError, appendQueryPrompt } from '../utils';
import { QueryAssistCallOut, QueryAssistCallOutType } from './call_outs';
import { QueryAssistInput } from './query_assist_input';
import { QueryAssistSubmitButton } from './submit_button';
import { useQueryAssist } from '../hooks';

interface QueryAssistInputProps {
  dependencies: QueryEditorExtensionDependencies;
}

export const QueryAssistBar: React.FC<QueryAssistInputProps> = (props) => {
  const { services } = useOpenSearchDashboards<IDataPluginServices>();
  const queryString = services.data.query.queryString;
  const inputRef = useRef<HTMLInputElement>(null);
  const storage = getStorage();
  const persistedLog: PersistedLog = useMemo(
    () => getPersistedLog(services.uiSettings, storage, 'query-assist'),
    [services.uiSettings, storage]
  );
  const { generateQuery, loading } = useGenerateQuery();
  const [callOutType, setCallOutType] = useState<QueryAssistCallOutType>();
  const dismissCallout = () => setCallOutType(undefined);
  const [agentError, setAgentError] = useState<AgentError>();
  const [selectedDataset, setSelectedDataset] = useState<Dataset | undefined>(
    queryString.getQuery().dataset
  );
  const selectedIndex = selectedDataset?.title;
  const previousQuestionRef = useRef<string>();
  const { updateQueryState } = useQueryAssist();

  useEffect(() => {
    const subscription = queryString.getUpdates$().subscribe((query) => {
      setSelectedDataset(query.dataset);
    });
    return () => subscription.unsubscribe();
  }, [queryString]);

  const onSubmit = async (e: SyntheticEvent) => {
    e.preventDefault();
    if (!inputRef.current?.value) {
      setCallOutType('empty_query');
      return;
    }
    if (!selectedIndex) {
      setCallOutType('empty_index');
      return;
    }
    dismissCallout();
    setAgentError(undefined);
    previousQuestionRef.current = inputRef.current.value;
    persistedLog.add(inputRef.current.value);
    const params: QueryAssistParameters = {
      // Only append query prompt in request payload
      question: appendQueryPrompt(inputRef.current.value),
      index: selectedIndex,
      language: props.dependencies.language,
      dataSourceId: selectedDataset?.dataSource?.id,
    };
    const { response, error } = await generateQuery(params);
    if (error) {
      if (error instanceof ProhibitedQueryError) {
        setCallOutType('invalid_query');
      } else if (error instanceof AgentError) {
        setAgentError(error);
      } else {
        services.notifications.toasts.addError(error, { title: 'Failed to generate results' });
      }
      updateQueryState({
        question: previousQuestionRef.current,
        generatedQuery: '', // query generate failed, set it to empty
      });
    } else if (response) {
      // force setQuery to proceed with updating the query
      services.data.query.queryString.setQuery(
        {
          query: response.query,
          language: params.language,
          dataset: selectedDataset,
        },
        true
      );
      updateQueryState({
        question: previousQuestionRef.current,
        generatedQuery: response.query,
      });
      if (response.timeRange) services.data.query.timefilter.timefilter.setTime(response.timeRange);
      setCallOutType('query_generated');
    }
  };

  if (props.dependencies.isCollapsed) return null;

  return (
    <EuiForm component="form" onSubmit={onSubmit} className="queryAssist queryAssist__form">
      <EuiFormRow fullWidth>
        <EuiFlexGroup gutterSize="xs" responsive={false} alignItems="center">
          <EuiFlexItem>
            <QueryAssistInput
              inputRef={inputRef}
              persistedLog={persistedLog}
              isDisabled={loading}
              selectedIndex={selectedIndex}
              previousQuestion={previousQuestionRef.current}
              error={agentError}
            />
          </EuiFlexItem>
          <EuiFlexItem grow={false}>
            <QueryAssistSubmitButton isDisabled={loading} />
          </EuiFlexItem>
        </EuiFlexGroup>
      </EuiFormRow>
      <QueryAssistCallOut
        language={props.dependencies.language}
        type={callOutType}
        onDismiss={dismissCallout}
      />
    </EuiForm>
  );
};

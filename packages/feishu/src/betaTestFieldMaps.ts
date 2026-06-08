/**
 * 飞书审批「域名与证书流程-beta-test」的 widget id 与 radioV2 选项值映射。
 * 与开放平台审批定义 API 返回的 form 结构一致；desktop.config.json 的 fieldMap 应与此对齐。
 */
import type { WidgetMapEntry } from "./types.js";

/** 申请类型 widget17419222507010001 */
export const APPLICATION_TYPE_OPTIONS = {
  域名购买: "m887j6q6-m69ir6kbha-0",
  域名解析: "m887j6q6-592kbg0i27a-0",
  域名续费: "m887j6q6-3vc5sv110h5-0",
  域名注册商转移: "m88hhn1u-o1vvwaasum-1",
  "域名DNSsever转移": "m9gnr82z-jbmakdyy6wp-1",
  证书购买: "mcvmmxu1-sp3un25gi19-1",
} as const;

export const PURCHASE_YEAR_OPTIONS = {
  "1年": "mb4nz288-jv9x9di7n0h-0",
  "2年": "mb4nz288-2srmd9d8qbu-0",
  "3年": "mb4nz288-xgdbyaa7qam-0",
  "3年(推荐)": "mb4nz288-xgdbyaa7qam-0",
  "5年": "mb4nz559-jx1k4uknqb-1",
} as const;

export const YES_NO_OPTIONS = {
  是: "mcvnfn35-om6owmwsvw-0",
  否: "mcvnfn35-25ixicewnwl-0",
} as const;

export const ICP_FILED_OPTIONS = {
  否: "m887tvjs-c9zptbxvsio-0",
  "是（若需备案需在流程提交前与运维沟通）": "m887tvjs-bxuyqdk82db-0",
  是: "m887tvjs-bxuyqdk82db-0",
} as const;

export const RESOLVE_OPERATION_OPTIONS = {
  新增: "mbhleh7m-aszxjxdaajr-0",
  修改: "mbhleh7m-2fwl2fj82ar-0",
  删除: "mbhleh7m-rgmhmhsskxn-0",
} as const;

export const RESOLVE_RECORD_TYPE_OPTIONS = {
  A: "m88e1d99-utpy0560mop-0",
  CNAME: "m88e1d99-n0wya7gvbo-0",
  MX: "m88e1d99-6gu1eo1u2o7-0",
  TXT: "m88e1d9f-72sdj4i86qm-1",
} as const;

export const RESOLVE_ADVANCED_OPTIONS = {
  否: "mbhkj2pc-aan8lz1f62h-0",
  是: "mbhkj2pc-7rw1ow6epss-0",
} as const;

export const RESOLVE_OPERATION_MODE_OPTIONS = {
  自动化操作: "mbhlxakt-4i00nv9aq1l-0",
  手动操作: "mbhlxakt-6m7eqok0o5u-0",
} as const;

/** 域名购买提交用的 fieldMap（同一 approval_code 下需带 applicationType=域名购买）。 */
export const BETA_TEST_DOMAIN_PURCHASE_FIELD_MAP: Record<string, WidgetMapEntry> = {
  applicationType: {
    id: "widget17419222507010001",
    type: "radioV2",
    options: { ...APPLICATION_TYPE_OPTIONS },
  },
  domainOwner: { id: "widget17419221592220001", type: "contact" },
  domainList: {
    id: "widget17419221901240001",
    type: "fieldList",
    children: {
      name: { id: "widget17419221986740001", type: "input" },
      years: {
        id: "widget17482383475270001",
        type: "radioV2",
        options: { ...PURCHASE_YEAR_OPTIONS },
      },
    },
  },
  providedInChinaMainland: {
    id: "widget17520468105280001",
    type: "radioV2",
    options: { ...YES_NO_OPTIONS },
  },
  icpFiled: {
    id: "widget17419227494310001",
    type: "radioV2",
    options: { ...ICP_FILED_OPTIONS },
  },
  reason: { id: "widget17446108389270001", type: "textarea" },
};

/** 域名解析提交用的 fieldMap（applicationType=域名解析）。 */
export const BETA_TEST_DOMAIN_RESOLVE_FIELD_MAP: Record<string, WidgetMapEntry> = {
  applicationType: {
    id: "widget17419222507010001",
    type: "radioV2",
    options: { ...APPLICATION_TYPE_OPTIONS },
  },
  domainResolveList: {
    id: "widget17419308246210001",
    type: "fieldList",
    children: {
      operationType: {
        id: "widget17490200882250001",
        type: "radioV2",
        options: { ...RESOLVE_OPERATION_OPTIONS },
      },
      prefix: { id: "widget17419308433630001", type: "input" },
      name: { id: "widget17419308439480001", type: "input" },
      recordType: {
        id: "widget17419331766690001",
        type: "radioV2",
        options: { ...RESOLVE_RECORD_TYPE_OPTIONS },
      },
      isAdvanced: {
        id: "widget17490186230870001",
        type: "radioV2",
        options: { ...RESOLVE_ADVANCED_OPTIONS },
      },
      value: { id: "widget17419308447880001", type: "input" },
    },
  },
  operationMode: {
    id: "widget17490209660920001",
    type: "radioV2",
    options: { ...RESOLVE_OPERATION_MODE_OPTIONS },
  },
  reason: { id: "widget17446108389270001", type: "textarea" },
};

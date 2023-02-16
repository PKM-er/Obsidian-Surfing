import React from "react";
import { FolderAddOutlined, FileImageOutlined, TableOutlined, FileTextOutlined, CrownTwoTone } from "@ant-design/icons";

type Props = {
	droppable: boolean;
	fileType?: string;
};

export const TypeIcon: React.FC<Props> = (props) => {
	if (props.droppable && !(props.fileType === "workspace")) {
		return <CrownTwoTone size={ 24 }/>;
	}

	switch (props.fileType) {
		case "image":
			return <FileImageOutlined size={ 24 }/>;
		case "csv":
			return <TableOutlined size={ 24 }/>;
		case "text":
			return <FileTextOutlined size={ 24 }/>;
		case "workspace":
			return <FolderAddOutlined size={ 24 }/>;
		default:
			return null;
	}
};
